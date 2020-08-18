#!/bin/bash

# Usage: ./tools/update_test_stack.sh <stack-name>

set -e

# Read the stack to update
if [ -z "$1" ]; then
    echo "Must specify a stack to update"
    exit 1
else
    STACK_NAME=$1
    ORIGINAL_RUN_ID="$(echo $1 | cut -d'-' -f5)"
fi

# Match the region that ./tools/create_test_stack.sh uses
AWS_REGION="sa-east-1"

# Move into the root directory, so this script can be called from any directory
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd $DIR/..

RUN_ID=$(head /dev/urandom | tr -dc A-Za-z0-9 | head -c10)

CURRENT_VERSION="$(grep -o 'Version: \d\+\.\d\+\.\d\+' template.yml | cut -d' ' -f2)-test-${ORIGINAL_RUN_ID}-update-${RUN_ID}"

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
PARAM_LIST=[$(param SourceZipUrl \"${MACRO_SOURCE_URL}\"),$(param FunctionName \"DatadogServerlessMacroLambda-test-${RUN_ID}\")]

CHANGE_SET_NAME="change-set-update-${RUN_ID}"

echo "Creating change set ${CHANGE_SET_NAME} for test stack ${STACK_NAME}"
aws cloudformation create-change-set --stack-name $STACK_NAME --template-url $TEMPLATE_URL --capabilities "CAPABILITY_AUTO_EXPAND" "CAPABILITY_IAM" \
    --parameters=$PARAM_LIST --region $AWS_REGION --change-set-name $CHANGE_SET_NAME

echo "Waiting for change set ${CHANGE_SET_NAME} to be created for test stack ${STACK_NAME}"
aws cloudformation wait change-set-create-complete --stack-name $STACK_NAME --change-set-name $CHANGE_SET_NAME --region $AWS_REGION

echo "Executing change set ${CHANGE_SET_NAME} for test stack ${STACK_NAME}"
aws cloudformation execute-change-set --change-set-name $CHANGE_SET_NAME --stack-name $STACK_NAME --region $AWS_REGION

echo "Completed stack update"