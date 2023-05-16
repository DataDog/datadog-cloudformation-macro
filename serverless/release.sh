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

# Read the current version
CURRENT_VERSION=$(grep -o 'Version: \d\+\.\d\+\.\d\+' template.yml | cut -d' ' -f2)

# Read the desired version
if [ -z "$2" ]; then
    echo "Must specify a desired version number"
    exit 1
elif [[ ! $2 =~ [0-9]+\.[0-9]+\.[0-9]+ ]]; then
    echo "Must use a semantic version, e.g., 3.1.4"
    exit 1
else
    VERSION=$2
fi

# Do a production release (default is staging) - useful for developers
if [[ $# -eq 3 ]] && [[ $3 = "--prod" ]]; then
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
yarn test 

if [ "$PROD_RELEASE" = true ] ; then

    if [[ ! $(./tools/semver.sh "$VERSION" "$CURRENT_VERSION") > 0 ]]; then
        echo "Must use a version greater than the current ($CURRENT_VERSION)"
        exit 1
    fi

    # Make sure we are on master
    BRANCH=$(git rev-parse --abbrev-ref HEAD)
    if [ $BRANCH != "master" ]; then
        echo "Not on master, aborting"
        exit 1
    fi

    # Confirm to proceed
    read -p "About to bump the version from ${CURRENT_VERSION} to ${VERSION}, create a release serverless-macro-${VERSION} on Github and upload the template.yml to s3://${BUCKET}/aws/serverless-macro/${VERSION}.yml. Continue (y/n)?" CONT
    if [ "$CONT" != "y" ]; then
        echo "Exiting"
        exit 1
    fi

    # Get the latest code
    git pull origin master

    # Bump version number
    echo "Bumping the current version number to the desired"
    perl -pi -e "s/Version: ${CURRENT_VERSION}/Version: ${VERSION}/g" template.yml
    yarn version --no-git-tag-version --new-version "${VERSION}"

    # Commit version number changes to git
    git add src/ template.yml README.md package.json
    git commit -m "Bump version from ${CURRENT_VERSION} to ${VERSION}"
    git push origin master

    # Create a github release
    echo "Release serverless-macro-${VERSION} to github"
    go get github.com/github/hub
    ./tools/build_zip.sh "${VERSION}"

    hub release create -a .macro/serverless-macro-${VERSION}.zip -m "serverless-macro-${VERSION}" serverless-macro-${VERSION}
    TEMPLATE_URL="https://${BUCKET}.s3.amazonaws.com/aws/serverless-macro/latest.yml"
    MACRO_SOURCE_URL="https://github.com/DataDog/datadog-cloudformation-macro/releases/download/serverless-macro-${VERSION}/serverless-macro-${VERSION}.zip'"
else
    echo "About to release non-public staging version of macro, upload serverless-macro-${VERSION} to s3, and upload the template.yml to s3://${BUCKET}/aws/serverless-macro-staging/${VERSION}.yml"
    # Upload to s3 instead of github
    ./tools/build_zip.sh "${VERSION}"
    aws s3 cp .macro/serverless-macro-${VERSION}.zip s3://${BUCKET}/aws/serverless-macro-staging-zip/serverless-macro-${VERSION}.zip
    TEMPLATE_URL="https://${BUCKET}.s3.amazonaws.com/aws/serverless-macro-staging/latest.yml"
    MACRO_SOURCE_URL="s3://${BUCKET}/aws/serverless-macro-staging-zip/serverless-macro-${VERSION}.zip"
fi

# Upload the template to the S3 bucket
echo "Uploading template.yml to s3://${BUCKET}/aws/serverless-macro/${VERSION}.yml"

if [ "$PROD_RELEASE" = true ] ; then
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

# echo "Done uploading the template, and here is the CloudFormation quick launch URL"
# echo "https://console.aws.amazon.com/cloudformation/home#/stacks/quickCreate?stackName=datadog-serverless-macro&templateURL=${TEMPLATE_URL}"

echo "Done!"