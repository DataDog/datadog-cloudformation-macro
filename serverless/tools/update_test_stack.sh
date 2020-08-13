#!/bin/bash

# Usage: ./tools/update_test_stack.sh <stack-name>

CURRENT_VERSION="$(grep -o 'Version: \d\+\.\d\+\.\d\+' template.yml | cut -d' ' -f2)-test"

# Default test bucket used in ./tools/create_test_stach.sh
BUCKET="datadog-cloudformation-template-staging"

# Set template and macro URLs
TEMPLATE_URL="https://${BUCKET}.s3.amazonaws.com/aws/serverless-macro-staging/latest.yml"
MACRO_SOURCE_URL="s3://${BUCKET}/aws/serverless-macro-staging-zip/serverless-macro-${CURRENT_VERSION}.zip"

# Match the region that ./tools/create_test_stack.sh uses
AWS_REGION="sa-east-1"

# Move into the root directory, so this script can be called from any directory
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd $DIR/..

# Read the stack to update
if [ -z "$1" ]; then
    echo "Must specify a stack to update"
    exit 1
else
    STACK_NAME=$1
fi

# Make a deployment for this stack
echo "Updating stack ${STACK_NAME}"
aws cloudformation update_stack --stack-name $STACK_NAME --template-url $TEMPLATE_URL --capabilities "CAPABILITY_AUTO_EXPAND" "CAPABILITY_IAM" \
    --parameters=$PARAM_LIST --region $AWS_REGION

echo "Waiting for stack to complete update for ${STACK_NAME}"
aws cloudformation wait stack-update-complete --stack-name $STACK_NAME --region $AWS_REGION

echo "Completed stack update"