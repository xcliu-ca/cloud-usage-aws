FROM redhat/ubi9

RUN dnf update; du -sh /usr /var /root; dnf install -y less unzip nodejs; du -sh /usr /var /root

ENV SLACK_TOKEN=
ENV AWS_ACCESS_KEY=
ENV AWS_SECRET_ACCESS_KEY=
ENV AWS_REGION=us-east-1
ENV SLACK_CHANNEL=#private-xcliu

RUN curl https://awscli.amazonaws.com/awscli-exe-linux-$(uname -m).zip -o "awscliv2.zip" && unzip awscliv2.zip && ./aws/install >/dev/null && rm -fr awscliv2.zip aws

WORKDIR /workdir
COPY Dockerfile .
COPY entry-point.sh .
COPY package.json .
COPY app.js .

ENTRYPOINT ["./entry-point.sh"]

