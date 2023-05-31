# cloud-usage-aws

## Generate aws usage report alerts [and optionally cleaning]

## Environment Variables

### required
- AWS_ACCESS_KEY
- AWS_SECRET_ACCESS_KEY

### optional
- AWS_REGION
- SLACK_TOKEN
- SLACK_CHANNEL
- SLACK_METION

## Deployment

### script
- `./entry-point.sh`

### docker
- `podman run --rm -it -e AWS_SECRET_ACCESS_KEY=your-secret-key -e AWS_ACCESS_KEY=your-key lospringliu/cloudreporter`

### kubernetes
- create secret `travis` and use `./deploy` (export your environment variables in file `travis.env`)
```
kubectl -n kube-system create secret generic travis --from-file=travis.env
kubectl create -f ./deploy
```
