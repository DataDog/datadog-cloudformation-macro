#!/bin/bash

# Usage: ./release.sh <S3_Bucket> <Version>

set -e

# Read the S3 bucket
if [ -z "$1" ]; then
    echo "Must specify a S3 bucket to publish the template"
    exit 1
else
    BUCKET=$1
fi

# Move into the serverless directory, so this script can be called from any directory
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd $DIR
# Extract current version from the template so that we can replace it with the new version
CURRENT_VERSION=$(grep -o 'Version: [0-9]\+\.[0-9]\+\.[0-9]\+' template.yml | cut -d' ' -f2)

# If current version is empty, exit
if [ -z "$CURRENT_VERSION" ]; then
    echo "Could not extract version from template.yml!"
    exit 1
else
    echo "Version from template.yml is ${CURRENT_VERSION}"
fi

# Do a production release (default is staging) - useful for developers
if [[ $# -eq 2 ]] && [[ $2 = "--prod" ]]; then
    PROD_RELEASE=true
else
    PROD_RELEASE=false
fi

# Validate identity
aws sts get-caller-identity

# Validate the template
echo "Validating template.yml"
aws cloudformation validate-template --template-body file://template.yml

# Build and run test suite
echo "Running unit tests and build script"

yarn install

# Tests on the gitlab runner fail
# https://gitlab.ddbuild.io/DataDog/datadog-cloudformation-macro/-/jobs/983419016
# yarn test

echo "$CI_PIPELINE_SOURCE"

if [ "$PROD_RELEASE" = true ] ; then
    if [ -z "$CI_COMMIT_TAG" ]; then
        printf "[Error] No CI_COMMIT_TAG found. Create a new tag for this prod release in repo first!\n"
        printf "Exiting script...\n"
        exit 1
    else
        printf "Tag found in environment: $CI_COMMIT_TAG\n"
    fi

    VERSION=$(echo "${CI_COMMIT_TAG##*v}" | cut -d'-' -f3-)

    # Validate that template.yml was already bumped to the release version (via PR)
    if [ "$VERSION" != "$CURRENT_VERSION" ]; then
        echo "Version mismatch: template.yml has ${CURRENT_VERSION} but tag indicates ${VERSION}"
        echo "Please create a PR to bump the version in template.yml and package.json before tagging."
        exit 1
    fi

    echo "Setting origin to github.com/DataDog/datadog-cloudformation-macro.git"
    git remote set-url origin https://x-access-token:$GH_TOKEN@github.com/DataDog/datadog-cloudformation-macro.git

    echo "Checking git auth status"
    gh auth status

    # Create a github release
    echo "Release serverless-macro-${VERSION} to github"
    tools/build_zip.sh "${VERSION}"

    echo "Releasing to github"
    gh release create -d serverless-macro-${VERSION} .macro/serverless-macro-${VERSION}.zip --generate-notes

    TEMPLATE_URL="https://${BUCKET}.s3.amazonaws.com/aws/serverless-macro/latest.yml"
    MACRO_SOURCE_URL="https://github.com/DataDog/datadog-cloudformation-macro/releases/download/serverless-macro-${VERSION}/serverless-macro-${VERSION}.zip"
else
    VERSION=${CI_COMMIT_SHA:-$(whoami)}
    tools/build_zip.sh "${VERSION}"
    MACRO_SOURCE_URL="s3://${BUCKET}/aws/serverless-macro-staging-zip/serverless-macro-${VERSION}.zip"
    TEMPLATE_URL="https://${BUCKET}.s3.amazonaws.com/aws/serverless-macro-staging/latest.yml"
    # Upload to s3 instead of github
    echo "About to release non-public staging version of macro, upload serverless-macro-${VERSION} to s3, and upload the template.yml to s3://${BUCKET}/aws/serverless-macro-staging/${VERSION}.yml"
    aws s3 cp .macro/serverless-macro-${VERSION}.zip s3://${BUCKET}/aws/serverless-macro-staging-zip/serverless-macro-${VERSION}.zip

fi

# Upload the template to the S3 bucket
if [ "$PROD_RELEASE" = true ] ; then
    echo "Uploading template.yml to s3://${BUCKET}/aws/serverless-macro/${VERSION}.yml"
    aws s3 cp template.yml s3://${BUCKET}/aws/serverless-macro/${VERSION}.yml
    aws s3 cp template.yml s3://${BUCKET}/aws/serverless-macro/latest.yml
    echo "Version ${VERSION} has been released"
    echo "Update release notes with included PRs: https://github.com/DataDog/datadog-cloudformation-macro/releases/tag/serverless-macro-${VERSION}"
else
    aws s3 cp template.yml s3://${BUCKET}/aws/serverless-macro-staging/${VERSION}.yml
    aws s3 cp template.yml s3://${BUCKET}/aws/serverless-macro-staging/latest.yml
    echo "Dev version ${VERSION} has been released"

fi

echo "Done uploading the template, and here is the CloudFormation quick launch URL"
echo "https://console.aws.amazon.com/cloudformation/home#/stacks/quickCreate?stackName=datadog-serverless-macro&templateURL=${TEMPLATE_URL}&param_SourceZipUrl=${MACRO_SOURCE_URL}"

echo "Done!"


