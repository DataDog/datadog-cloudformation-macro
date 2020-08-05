#!/bin/bash

# Tests installation and deployment process of macro, and that CloudFormation template works.
set -e

# Deploy the stack to a less commonly used region to avoid any problems with limits
AWS_REGION="sa-east-1"

# Move into the root directory, so this script can be called from any directory
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd $DIR/..

RUN_ID=$(head /dev/urandom | tr -dc A-Za-z0-9 | head -c10)

CURRENT_VERSION="$(grep -o 'Version: \d\+\.\d\+\.\d\+' template.yml | cut -d' ' -f2)-staging-${RUN_ID}"

# Make sure we aren't trying to do anything on Datadog's production account. We don't want our
# integration tests to accidentally release a new version of the macro
AWS_ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
if [ "$AWS_ACCOUNT" = "464622532012" ] ; then
    echo "Detected production credentials. Aborting"
    exit 1
fi

# Run script in this process. This gives us TEMPLATE_URL and MACRO_SOURCE_URL env vars
. release.sh datadog-cloudformation-macro-staging $CURRENT_VERSION

function param {
    KEY=$1
    VALUE=$2
    echo "{\"ParameterKey\":\"${KEY}\",\"ParameterValue\":${VALUE}}"
}

PARAM_LIST=[$(param SourceZipUrl \"${MACRO_SOURCE_URL}\")]
echo "Setting params ${PARAM_LIST}"

# Create an instance of the stack
STACK_NAME="dd-cfn-macro-integration-stack-${RUN_ID}"
echo "Creating stack ${STACK_NAME}"
aws cloudformation create-stack --stack-name $STACK_NAME --template-url $TEMPLATE_URL --capabilities "CAPABILITY_AUTO_EXPAND" "CAPABILITY_IAM" --on-failure "DELETE" \
    --parameters=$PARAM_LIST --region $AWS_REGION

echo "Waiting for stack to complete creation ${STACK_NAME}"
aws cloudformation wait stack-create-complete --stack-name $STACK_NAME --region $AWS_REGION

echo "Completed stack creation"

# echo "Cleaning up stack"
aws cloudformation delete-stack --stack-name $STACK_NAME  --region $AWS_REGION