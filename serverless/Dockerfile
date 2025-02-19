FROM registry.ddbuild.io/images/docker:24.0.5

RUN apt-get update && apt-get install -y --no-install-recommends \
    wget curl gnupg unzip zip jq uuid-runtime

# Install AWS CLI.
RUN  curl 'https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip' -o "awscliv2.zip"
RUN unzip awscliv2.zip && ./aws/install

