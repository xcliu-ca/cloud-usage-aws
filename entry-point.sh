#!/bin/bash

# NODE_BINARY=node-v18.16.0-linux-$(uname -m | sed -e 's/x86_64/x64/' -e 's/aarch64/arm64/');
# curl https://nodejs.org/dist/v18.16.0/$NODE_BINARY.tar.xz | tar Jxf -;
# ln -sf /$NODE_BINARY/bin/node /usr/local/bin/node;
# ln -sf /$NODE_BINARY/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm;
# ln -sf /$NODE_BINARY/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx;

mkdir -p ~/.aws
echo -e "[default]\nregion = $AWS_REGION" > ~/.aws/config
echo -e "[default]\naws_access_key_id = $AWS_ACCESS_KEY\naws_secret_access_key = $AWS_SECRET_ACCESS_KEY" > ~/.aws/credentials

aws --version

curl -o app.js https://raw.githubusercontent.com/xcliu-ca/cloud-usage-aws/main/app.js
curl -o package.json https://raw.githubusercontent.com/xcliu-ca/cloud-usage-aws/main/package.json

npm install
node app.js
