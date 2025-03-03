FROM registry.ddbuild.io/images/docker:24.0.5

RUN apt-get update && apt-get install -y --no-install-recommends \
    wget curl gnupg unzip zip jq uuid-runtime

RUN mkdir -p /etc/apt/keyrings && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
# We are explicitly setting the node_20.x version for the installation
RUN echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list
RUN apt-get update && apt-get install nodejs -y
RUN npm install --global yarn

# Install AWS CLI.

RUN  curl 'https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip' -o "awscliv2.zip"
RUN unzip awscliv2.zip && ./aws/install

