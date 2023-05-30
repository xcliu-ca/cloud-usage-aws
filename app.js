const Koa = require('koa')
const bodyParser = require("koa-bodyparser")
const vcore = require("@vueuse/core")
const execa = require("execa")
const chalk = require("chalk")
const { ref, computed, watch } = require("vue")
const { WebClient } = require('@slack/web-api')
// console.log(Object.keys(vmath))
// console.log(Object.keys(execa))

// constants
const MAP_ACTIONS = {
  "ciddread@us.ibm.com": {mention: "<!subteam^icp-cicd>", notify: 3, cleanup: 4}, // need group id
  "c3cvt3vm@ca.ibm.com": {mention: "<!subteam^icp-sert>", notify: 4}, // need group id
  "unknown@ibm.com": {mention: "<@" + process.env.SLACK_MENTION + ">", notify: 4}
}
// reactive variables 
const aws_query_ec2 = ref({})
const aws_query_ec2_ca = ref({})
const aws_query_vpc = ref({})
const aws_query_vpc_ca = ref({})
const aws_ec2 = ref({})
const aws_vpc = ref({})
// global flags
const flag_awscli_working = ref(false)
const flag_slack_working = ref(false)

// slack related
const slack = new WebClient(process.env.SLACK_TOKEN)
const channel = ref(process.env.SLACK_CHANNEL)
const subject = ref('Some slack message <@xcliu>')
const code = ref('console.log("hello slack")')
const text = computed(() => `${subject.value}\n\`\`\`\n${code.value}\n\`\`\`\n`)

// compute ec2 instances
const aws_ec2_active = computed(() => Object.values(aws_ec2.value)
  .filter(instance => instance.State && instance.State.Name === "running")
)

// compute ec2 clusters
const aws_ec2_clusters = computed(() => aws_ec2_active.value // openshift + rosa + eks
  .filter(instance => {
    return instance.Tags.findIndex(tag => tag.Key === "Name" || tag.Key === "name") !== -1 &&
    (instance.Tags.findIndex(tag => tag.Key === "Owner" || tag.Key === "owner") !== -1 &&
    instance.Tags.findIndex(tag => tag.Key === "Cluster" || tag.Key === "cluster") !== -1 ||
    instance.Tags.findIndex(tag => tag.Key === "red-hat-managed") !== -1 ||
    instance.Tags.findIndex(tag => tag.Key === "eks:cluster-name") !== -1)
  })
  .map(instance => {
    instance.name = instance.Tags.find(tag => tag.Key === "Name" || tag.Key === "name").Value
    if (instance.Tags.findIndex(tag => tag.Key === "red-hat-managed") !== -1) {
      // rosa cluster
      if (/cicd-/.test(instance.name)) {
        instance.owner = "cicdread@ca.ibm.com"
      } else if (/sert-/.test(instance.name)) {
        instance.owner = "c3cvt3vm@ca.ibm.com"
      } else {
        instance.owner = "unknown@ibm.com"
      }
      instance.cluster = instance.name.replace(/-worker-.*/,"")
    } else if (instance.Tags.findIndex(tag => tag.Key === "eks:cluster-name") !== -1) {
      if (/cicd-|prow-/.test(instance.name)) {
        instance.owner = "cicdread@ca.ibm.com"
      } else if (/sert-/.test(instance.name)) {
        instance.owner = "c3cvt3vm@ca.ibm.com"
      } else {
        instance.owner = "unknown@ibm.com"
      }
      instance.cluster = instance.Tags.find(tag => tag.Key === "eks:cluster-name").Value.toLowerCase()
    } else {
      instance.owner = instance.Tags.find(tag => tag.Key === "Owner" || tag.Key === "owner").Value.toLowerCase()
      instance.cluster = instance.Tags.find(tag => tag.Key === "Cluster" || tag.Key === "cluster").Value.toLowerCase()
    }
    const tag = instance.Tags.find(tag => tag.Key === "Spending_Env" || tag.Key === "spending_env")
    if (tag) {
      instance.spendingenv = tag.Value.toLowerCase()
    } else {
      instance.spendingenv = "test"
    }
    // console.log(instance)
    return instance
  })
  .sort((x,y) => x.name > y.name ? 1 : -1)
  .reduce(reduce_cluster, {})
) 
// compute all active clusters
const clusters_active = computed(() => Object.entries(aws_ec2_clusters.value)
    .map(([cluster,members]) => ({
      name: cluster,
      owner: members[members.length - 1].owner,
      launch: members[0].LaunchTime,
      vpc: members[members.length - 1].VpcId,
      type: members[members.length - 1].InstanceType,
      // owner: members.map(i => i.owner).filter((value, index, array) => array.indexOf(value) === index),
      // vpc: members.map(i => i.VpcId).filter((value, index, array) => array.indexOf(value) === index),
      spending: members[0].spendingenv,
      instances: members.length
    }))
)
const clusters_notify = computed(() => clusters_active.value
  .filter(c => c.spending === "test")
  .filter(c => new Date() - new Date(c.launch) > (MAP_ACTIONS[c.owner].notify || 4) * 60 * 60 * 1000)
)

vcore.watchDeep(aws_vpc, () => {
  console.log(`total vpc instances: ${Object.keys(aws_vpc.value).length}`)
})
vcore.watchDeep(aws_ec2, () => {
  console.log(`total ec2 instances: ${Object.keys(aws_ec2.value).length}`)
  print_instances()
  setTimeout(() => console.log(clusters_active.value), 100)
  // setTimeout(() => Object.values(aws_ec2.value).forEach(i => console.log(i.Tags.find(t => t.Key === "Name"))), 5000)
})

// process aws query results
watch(aws_query_vpc, () => {
  aws_query_vpc.value["Vpcs"].forEach(vpc => aws_vpc.value[vpc["VpcId"]] = vpc)
  aws_query_vpc_ca.value["Vpcs"].forEach(vpc => aws_vpc.value[vpc["VpcId"]] = vpc)
  Object.keys(aws_vpc.value).forEach(key => console.log(key))
})
watch(aws_query_ec2, () => {
  Object.keys(aws_query_ec2_ca.value).forEach(key => {
    aws_query_ec2_ca.value[key].forEach(reservation => {
      reservation.Instances.forEach(i => {
        aws_ec2.value[i.InstanceId] = i
      })
    })
  })
  Object.keys(aws_query_ec2.value).forEach(key => {
    aws_query_ec2.value[key].forEach(reservation => {
      reservation.Instances.forEach(i => {
        aws_ec2.value[i.InstanceId] = i
      })
    })
  })
})

// periodically refresh querys and status
status().then(() => refresh()).then(() => status())
setInterval(refresh, 2 * 60 * 1000)
setInterval(status, 60 * 1000)

// for koa application
function APIError (code, message) {
  this.code = code || 'internal:unknown_error'
  this.message = message || ''
  this.flag_awscli_working = flag_awscli_working.value
  this.flag_slack_working = flag_slack_working.value
}

const app = new Koa();
app.use(bodyParser())

// save parameters
app.use(async (ctx, next) => {
  ctx.body = ctx.request.body
  ctx.response.type = 'application/json'
  ctx.response.status = 200
  await next()
})

// install restify
app.use(async (ctx, next) => {
  ctx.rest = (data) => {
    ctx.response.body = Object.assign(data, {
      flag_awscli_working: flag_awscli_working.value,
      flag_slack_working: flag_slack_working.value
    })
  }
  try {
    await next()
  } catch (e) {
    ctx.response.status = 400
    ctx.response.body = {
      code: e.code || 'internal:unknown_error',
      message: e.message || '',
      flag_awscli_working: flag_awscli_working.value,
      flag_slack_working: flag_slack_working.value
    }
  }
})

// answer request
app.use(async (ctx, next) => {
  await next()
  ctx.rest({})
});

// aws cli health
app.use(async (ctx, next) => {
  if (!flag_awscli_working.value) {
    throw new APIError('env:cli', 'awscli can not query')
  }
  await next()
});

app.listen(3000);
console.log(chalk.cyan('api started at port 3000...'))

// function to query status
async function status(url_addr="http://127.0.0.1:3000", timeout=20) {
  console.log(chalk.green(`... querying status`))
  try {
    const result = await execa.command('curl localhost:3000', {shell: true})
    console.log(JSON.parse(result.stdout))
  } catch (e) {}
}

// function to refresh with imagecontentsourcepolicy and global pull secret
async function refresh () {
  console.log(chalk.green(`... refreshing information`))
  try {
    aws_query_vpc_ca.value = JSON.parse((await execa.command('aws ec2 describe-vpcs --region ca-central-1', {shell: true})).stdout)
    flag_awscli_working.value = true
  } catch (e) {
    flag_awscli_working.value = false
    console.error(e)
  }
  try {
    aws_query_vpc.value = JSON.parse((await execa.command('aws ec2 describe-vpcs', {shell: true})).stdout)
    flag_awscli_working.value = true
  } catch (e) {
    flag_awscli_working.value = false
    console.error(e)
  }
  try {
    aws_query_ec2_ca.value = JSON.parse((await execa.command('aws ec2 describe-instances --region ca-central-1', {shell: true})).stdout)
    flag_awscli_working.value = true
  } catch (e) {
    flag_awscli_working.value = false
    console.error(e)
  }
  try {
    aws_query_ec2.value = JSON.parse((await execa.command('aws ec2 describe-instances', {shell: true})).stdout)
    flag_awscli_working.value = true
  } catch (e) {
    flag_awscli_working.value = false
    console.error(e)
  }
}

// reduce instances array to cluster object 
function reduce_cluster (acc, value) { // each value is an instance
  if (acc.hasOwnProperty(value.cluster)) {
    acc[value.cluster].push(value)
  } else {
    acc[value.cluster] = [ value ]
  }
  return acc
}

// print running ec2 instances
function print_instances () {
  const ec2s = []
  aws_ec2_active.value.forEach(instance => {
    const tag_name = instance.Tags.findIndex(tag => tag.Key === "Name" || tag.Key === "name")
    if (tag_name !== -1) {
      ec2s.push(instance.Tags[tag_name].Value)
    }
  })
  console.log(ec2s.sort())
}

// send slack notifications
const blocks = computed(() => [
  {
    type: "section",
    text: {
      type: "plain_text",
      text: subject.value
    }
  },
  {
    type: "section",
    text: {
      type: "mrkdwn",
      text: `\`\`\`\n${code.value}\n\`\`\`\n`
    }
  }
  
])
vcore.watchThrottled(code, () => {
    slack.chat.postMessage({blocks: JSON.stringify(blocks.value), text: text.value, channel: channel.value})
      .then(() => flag_slack_working.value = true)
      .catch(() => flag_slack_working.value = false)
  }, { throttle: 60 * 60 * 1000 })
watch(clusters_notify, () => {
    if (clusters_notify.value.length > 0) {
      subject.value = `:warning: long running aws clusters`
      clusters_notify.value.map(c => c.owner).filter((value, index, array) => array.indexOf(value) === index).forEach(owner => subject.value += ` ${MAP_ACTIONS[owner].mention || "mentions"} `)
      code.value = JSON.stringify(clusters_notify.value.map(c => Object.assign({}, c, {launch: vcore.useTimeAgo(new Date(c.launch)).value})), "", 2)
    }
})

vcore.watchThrottled(clusters_active, () => {
    slack.chat.postMessage({
      text: `:info_2: current active aws clusters\n
\`\`\`
${clusters_active.value.map(cluster => cluster.name.padEnd(24) + cluster.owner.padEnd(24) + cluster.spending.padEnd(12) + cluster.instances + " x instances    " + vcore.useTimeAgo(new Date(cluster.launch)).value).join("\n")}
\`\`\`
config\n
\`\`\`
${JSON.stringify(MAP_ACTIONS,"", 2).replace(/..subteam/,"subteam")}
\`\`\`
`,
      channel: channel.value
    }).then(() => flag_slack_working.value = true)
      .catch(() => flag_slack_working.value = false)
  }, { throttle: 12 * 60 * 60 * 1000 })