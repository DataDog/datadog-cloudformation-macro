#!/bin/bash

# Retrieve External ID from Vault
echo "Retrieving External ID..."
EXTERNAL_ID=$(vault kv get -field="${EXTERNAL_ID_NAME}" kv/k8s/gitlab-runner/datadog-cloudformation-macro/secrets)

# Ensure EXTERNAL_ID is retrieved
if [ -z "$EXTERNAL_ID" ]; then
    echo "[Error] Failed to retrieve EXTERNAL_ID."
    exit 1
fi

# Assume AWS IAM Role
echo "Assuming AWS IAM Role..."
CREDENTIALS=$(aws sts assume-role \
    --role-arn "arn:aws:iam::${ACCOUNT}:role/${ROLE_TO_ASSUME}" \
    --role-session-name "ci.datadog-cloudformation-macro-${CI_JOB_ID}-${CI_JOB_STAGE}" \
    --query "Credentials.[AccessKeyId,SecretAccessKey,SessionToken]" \
    --external-id "${EXTERNAL_ID}" \
    --output text)

# Ensure credentials were retrieved
if [ -z "$CREDENTIALS" ]; then
    echo "[Error] Failed to assume AWS IAM role."
    exit 1
fi

# Parse AWS credentials
read AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN <<< "$CREDENTIALS"

# Export AWS credentials for future commands
export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN

# Success message
echo "AWS credentials successfully retrieved and exported!"