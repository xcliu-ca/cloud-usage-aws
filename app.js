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
  "ciddread@us.ibm.com": {mention: "icp-cicd", notify: 3, cleanup: 4},
  "c3cvt3vm@ca.ibm.com": {mention: "icp-sert", notify: 4},
  "unknown@ibm.com": {mention: "xcliu", notify: 4}
}
// slack related
const slack = new WebClient(process.env.SLACK_TOKEN)
const channel = ref(process.env.SLACK_CHANNEL)
const subject = ref('Some slack message <@xcliu>')
const code = ref('console.log("hello slack")')
const text = computed(() => `${subject.value}\n
\`\`\`
${code.value}
\`\`\`
`
)
// reactive variables 
const aws_query_ec2 = ref({})
const aws_query_vpc = ref({})
const aws_ec2 = ref({})
const aws_vpc = ref({})
const clusters_notify = ref([])
// global flags
const flag_awscli_working = ref(false)
const flag_slack_working = ref(false)

const aws_ec2_active = computed(() => Object.values(aws_ec2.value)
  .filter(instance => instance.State && instance.State.Name === "running")
)
const aws_ec2_clusters = computed(() => Object.values(aws_ec2.value)
  .filter(instance => instance.State && instance.State.Name === "running")
  .filter(instance => {
    return instance.Tags.findIndex(tag => tag.Key === "Name" || tag.Key === "name") !== -1 &&
    (instance.Tags.findIndex(tag => tag.Key === "Owner" || tag.Key === "owner") !== -1 &&
    instance.Tags.findIndex(tag => tag.Key === "Cluster" || tag.Key === "cluster") !== -1 ||
    instance.Tags.findIndex(tag => tag.Key === "red-hat-managed") !== -1 &&
    instance.Tags.findIndex(tag => tag.Key === "red-hat-clustertype") !== -1)
  })
  .map(instance => {
    instance.name = instance.Tags.find(tag => tag.Key === "Name" || tag.Key === "name").Value
    if (instance.Tags.findIndex(tag => tag.Key === "red-hat-managed") !== -1) {
      // rosa cluster
      if (/sert-/.test(i.name)) {
        instance.owner = "c3cvt3vm@ca.ibm.com"
      } else {
        instance.owner = "unkown@ibm.com"
      }
      instance.cluster = instance.name.replace(/-worker-.*/,"")
    } else {
      instance.owner = instance.Tags.find(tag => tag.Key === "Owner" || tag.Key === "owner").Value
      instance.cluster = instance.Tags.find(tag => tag.Key === "Cluster" || tag.Key === "cluster").Value
    }
    const tag = instance.Tags.find(tag => tag.Key === "Spending_Env" || tag.Key === "spending_env")
    if (tag) {
      instance.spendingenv = tag.Value
    } else {
      instance.spendingenv = "test"
    }
    // console.log(instance)
    return instance
  })
  .sort((x,y) => x.name > y.name ? 1 : -1)
  .reduce(reduce_cluster, {})
) 

vcore.watchDeep(aws_vpc, () => {
  console.log(`total vpc instances: ${Object.keys(aws_vpc.value).length}`)
})
vcore.watchDeep(aws_ec2, () => {
  console.log(`total ec2 instances: ${Object.keys(aws_ec2.value).length}`)
  setTimeout(() => {
    const ec2s = []
    aws_ec2_active.value.forEach(instance => {
      const tag_name = instance.Tags.findIndex(tag => tag.Key === "Name")
      if (tag_name !== -1) {
        ec2s.push(instance.Tags[tag_name].Value)
      }
    })
    console.log(ec2s.sort())
  }, 100)
  setTimeout(() => {
    const clusters = Object.entries(aws_ec2_clusters.value).map(([cluster,members]) => ({
      name: cluster,
      owner: members[members.length - 1].owner,
      launch: members[0].LaunchTime,
      vpc: members[members.length - 1].VpcId,
      type: members[members.length - 1].InstanceType,
      // owner: members.map(i => i.owner).filter((value, index, array) => array.indexOf(value) === index),
      // vpc: members.map(i => i.VpcId).filter((value, index, array) => array.indexOf(value) === index),
      instances: members.length
    }))
    console.log(clusters)
    clusters_notify.value = clusters.filter(c => new Date() - new Date(c.launch) > MAP_ACTIONS[c.owner].notify * 60 * 60 * 1000)
    if (clusters_notify.value.length > 0) {
      code.value = JSON.stringify(clusters_notify.value.map(c => Object.assign({}, c, {launch: vcore.useTimeAgo(new Date(c.launch)).value})), "", 2)
      subject.value = `notifying long run aws clusters`
      clusters_notify.value.map(c => c.owner).filter((value, index, array) => array.indexOf(value) === index).forEach(owner => subject.value += ` <@${MAP_ACTIONS[owner].mention}> `)
      slack.chat.postMessage({type: "mrkdwn", text: text.value, channel: channel.value})
        .then(() => flag_slack_working.value = true)
        .catch(() => flag_slack_working.value = false)
    }
  }, 200)
})

watch(aws_query_vpc, () => {
  aws_query_vpc.value["Vpcs"].forEach(vpc => aws_vpc.value[vpc["VpcId"]] = vpc)
  Object.keys(aws_vpc.value).forEach(key => console.log(key))
})
watch(aws_query_ec2, () => {
  Object.keys(aws_query_ec2.value).forEach(key => {
    aws_query_ec2.value[key].forEach(reservation => {
      reservation.Instances.forEach(i => {
        aws_ec2.value[i.InstanceId] = i
      })
    })
  })
})

status().then(() => refresh()).then(() => status())
setInterval(refresh, 5 * 60 * 1000)
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

// cluster health
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
    aws_query_vpc.value = JSON.parse((await execa.command('aws ec2 describe-vpcs', {shell: true})).stdout)
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
    console.log(execa.commandSync(`cat ~/.aws/*`, {shell: true}).stdout)
    console.error(e)
  }
}

// base64 decoder
function decode(encoded="") {
  const decodedStr = Buffer.from(encoded.trim(), 'base64').toString('utf-8')
  if (!decodedStr) {
    return ''
  }
  return JSON.parse(decodedStr)
}

// reduce icsp mirrors from array to object
function reduce_cluster (acc, value) { // each value is an instance
  if (acc.hasOwnProperty(value.cluster)) {
    acc[value.cluster].push(value)
  } else {
    acc[value.cluster] = [ value ]
  }
  return acc
}
