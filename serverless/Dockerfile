FROM registry.ddbuild.io/images/docker:24.0.5

RUN apt-get update && apt-get install -y --no-install-recommends \
    wget curl gnupg unzip zip jq uuid-runtime

RUN set -x \
    && curl -sS https://dl.yarnpkg.com/debian/pubkey.gpg | apt-key add - \
    && echo "deb https://dl.yarnpkg.com/debian/ stable main" | tee /etc/apt/sources.list.d/yarn.list \
    && apt-get update \
    && apt-get -y install --no-install-recommends yarn \
    && apt-get -y clean \
    && rm -rf /var/lib/apt/lists/*

# Install AWS CLI.

RUN curl 'https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip' -o "awscliv2.zip"
RUN unzip awscliv2.zip && ./aws/install

