#!/bin/bash

# Usage: ./tools/update_test_stack.sh <stack-name>

set -e

# Read the stack to update
if [ -z "$1" ]; then
    echo "Must specify a stack to update"
    exit 1
else
    STACK_NAME=$1
fi

# Match the region that ./tools/create_test_stack.sh uses
AWS_REGION="sa-east-1"

# Move into the root directory, so this script can be called from any directory
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd $DIR/..

CURRENT_VERSION="$(grep -o 'Version: \d\+\.\d\+\.\d\+' template.yml | cut -d' ' -f2)-test"

# Make sure we aren't trying to do anything on Datadog's production account. We don't want our
# integration tests to accidentally release a new version of the macro
AWS_ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
if [ "$AWS_ACCOUNT" = "464622532012" ] ; then
    echo "Detected production credentials. Aborting"
    exit 1
fi

# Default test bucket used in ./tools/create_test_stack.sh
BUCKET="datadog-cloudformation-template-staging"

# Run script in this process. This gives us TEMPLATE_URL and MACRO_SOURCE_URL env vars
. release.sh $BUCKET $CURRENT_VERSION

function param {
    KEY=$1
    VALUE=$2
    echo "{\"ParameterKey\":\"${KEY}\",\"ParameterValue\":${VALUE}}"
}

echo "Setting params ${PARAM_LIST}"
PARAM_LIST=[$(param SourceZipUrl \"${MACRO_SOURCE_URL}\")]

# Make a deployment for this stack
echo "Updating stack ${STACK_NAME}"
aws cloudformation update-stack --stack-name $STACK_NAME --template-url $TEMPLATE_URL --capabilities "CAPABILITY_AUTO_EXPAND" "CAPABILITY_IAM" \
    --parameters=$PARAM_LIST --region $AWS_REGION

echo "Waiting for stack to complete update for ${STACK_NAME}"
aws cloudformation wait stack-update-complete --stack-name $STACK_NAME --region $AWS_REGION

echo "Completed stack update"
