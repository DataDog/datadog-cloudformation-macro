#!/bin/bash

# Usage: ./release.sh <S3_Bucket> <Version>

# set -e

# Read the S3 bucket
if [ -z "$1" ]; then
    echo "Must specify a S3 bucket to publish the template"
    exit 1
else
    BUCKET=$1
fi

cd serverless

# Read the current version
CURRENT_VERSION=$(grep -o 'Version: \d\+\.\d\+\.\d\+' template.yml | cut -d' ' -f2)

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

yarn add --dev @types/jest
yarn test

echo "$CI_PIPELINE_SOURCE"

# testing gh authentiation
 gh auth login --with-token < "$GH_TOKEN"
 gh auth status

if [ "$PROD_RELEASE" = true ] ; then
    if [ -z "$CI_COMMIT_TAG" ]; then
        printf "[Error] No CI_COMMIT_TAG found.\n"
        printf "Exiting script...\n"
        exit 1
    else
        printf "Tag found in environment: $CI_COMMIT_TAG\n"
    fi

    VERSION=$(echo "${CI_COMMIT_TAG##*v}" | cut -d'-' -f3-)

    if [[ ! $(tools/semver.sh "$VERSION" "$CURRENT_VERSION") > 0 ]]; then
        echo "Must use a version greater than the current ($CURRENT_VERSION)"
        exit 1
    fi

    # Get the latest code
    git pull origin main 

    # Bump version number
    echo "Bumping the current version number to the desired"
    perl -pi -e "s/Version: ${CURRENT_VERSION}/Version: ${VERSION}/g" template.yml

    yarn version --no-git-tag-version --new-version "${VERSION}"
    

    # Commit version number changes to git
    git add src/ template.yml ../README.md package.json
    git commit -m "Bump version from ${CURRENT_VERSION} to ${VERSION}"
    git push origin main

    # Create a github release
    echo "Release serverless-macro-${VERSION} to github"
    tools/build_zip.sh "${VERSION}"

    gh auth login --with-token <<< "$GH_TOKEN"

    gh release create serverless-macro-${VERSION} .macro/serverless-macro-${VERSION}.zip --generate-notes
    TEMPLATE_URL="https://${BUCKET}.s3.amazonaws.com/aws/serverless-macro/latest.yml"
    MACRO_SOURCE_URL="https://github.com/DataDog/datadog-cloudformation-macro/releases/download/serverless-macro-${VERSION}/serverless-macro-${VERSION}.zip'"
else
    VERSION=$CI_COMMIT_SHA
    echo "About to release non-public staging version of macro, upload serverless-macro-${VERSION} to s3, and upload the template.yml to s3://${BUCKET}/aws/serverless-macro-staging/${VERSION}.yml"
    # Upload to s3 instead of github
    tools/build_zip.sh "${VERSION}"
    aws s3 cp .macro/serverless-macro-${VERSION}.zip s3://${BUCKET}/aws/serverless-macro-staging-zip/serverless-macro-${VERSION}.zip
    TEMPLATE_URL="https://${BUCKET}.s3.amazonaws.com/aws/serverless-macro-staging/latest.yml"
    MACRO_SOURCE_URL="s3://${BUCKET}/aws/serverless-macro-staging-zip/serverless-macro-${VERSION}.zip"
fi

# Upload the template to the S3 bucket
if [ "$PROD_RELEASE" = true ] ; then
    echo "Uploading template.yml to s3://${BUCKET}/aws/serverless-macro/${VERSION}.yml"
    aws s3 cp template.yml s3://${BUCKET}/aws/serverless-macro/${VERSION}.yml \
        --grants read=uri=http://acs.amazonaws.com/groups/global/AllUsers
    aws s3 cp template.yml s3://${BUCKET}/aws/serverless-macro/latest.yml \
        --grants read=uri=http://acs.amazonaws.com/groups/global/AllUsers
    echo "Version ${VERSION} has been released"
    echo "Update release notes with included PRs: https://github.com/DataDog/datadog-cloudformation-macro/releases/tag/serverless-macro-${VERSION}"
else
    aws s3 cp template.yml s3://${BUCKET}/aws/serverless-macro-staging/${VERSION}.yml
    aws s3 cp template.yml s3://${BUCKET}/aws/serverless-macro-staging/latest.yml
    echo "Dev version ${VERSION} has been released"

fi

echo "Done uploading the template, and here is the CloudFormation quick launch URL"
echo "https://console.aws.amazon.com/cloudformation/home#/stacks/quickCreate?stackName=datadog-serverless-macro&templateURL=${TEMPLATE_URL}"

echo "Done!"


