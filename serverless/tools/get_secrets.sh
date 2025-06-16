#!/bin/bash

# Unless explicitly stated otherwise all files in this repository are licensed
# under the Apache License Version 2.0.
# This product includes software developed at Datadog (https://www.datadoghq.com/).
# Copyright 2025 Datadog, Inc.

set -e

# Get the JWT
export GH_APP_ID=$(vault kv get -field="gh_app_id" kv/k8s/gitlab-runner/datadog-cloudformation-macro/secrets)
export GH_PRIVATE_KEY=$(vault kv get -field="gh_private_key" kv/k8s/gitlab-runner/datadog-cloudformation-macro/secrets)

# Write private key to a temporary file
PRIVATE_KEY_FILE=$(mktemp)
echo "$GH_PRIVATE_KEY" > "$PRIVATE_KEY_FILE"

# Get the GH token
export GH_TOKEN=$(bash serverless/tools/generate_jwt.sh $GH_APP_ID $PRIVATE_KEY_FILE)


if [ -z "$EXTERNAL_ID_NAME" ]; then
    printf "[Error] No EXTERNAL_ID_NAME found.\n"
    printf "Exiting script...\n"
    exit 1
fi

if [ -z "$ROLE_TO_ASSUME" ]; then
    printf "[Error] No ROLE_TO_ASSUME found.\n"
    printf "Exiting script...\n"
    exit 1
fi

printf "Getting AWS External ID...\n"
EXTERNAL_ID=$(vault kv get -field="${EXTERNAL_ID_NAME}" kv/k8s/gitlab-runner/datadog-cloudformation-macro/secrets)

printf "Assuming role...\n"
export $(printf "AWS_ACCESS_KEY_ID=%s AWS_SECRET_ACCESS_KEY=%s AWS_SESSION_TOKEN=%s" \
    $(aws sts assume-role \
    --role-arn "arn:aws:iam::$AWS_ACCOUNT:role/$ROLE_TO_ASSUME"  \
    --role-session-name "ci.datadog-cloudformation-macro-$CI_JOB_ID-$CI_JOB_STAGE" \
    --query "Credentials.[AccessKeyId,SecretAccessKey,SessionToken]" \
    --external-id $EXTERNAL_ID \
    --output text))


