#!/bin/bash

set -e

# Move into the tools directory
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd $DIR

# Read the desired version
if [ -z "$1" ]; then
    echo "Must specify a desired version number"
    exit 1
elif [[ ! $1 =~ [0-9]+\.[0-9]+\.[0-9]+ ]]; then
    echo "Must use a semantic version, e.g., 3.1.4"
    exit 1
else
    VERSION=$1
fi

MACRO_PREFIX="serverless-macro"
MACRO_DIR="../.macro"

function make_path_absolute {
    echo "$(cd "$(dirname "$1")"; pwd)/$(basename "$1")"
}

rm -rf $MACRO_DIR
mkdir $MACRO_DIR

echo "Building zip file for macro"
destination=$(make_path_absolute "${MACRO_DIR}/${MACRO_PREFIX}-${VERSION}.zip")
(cd ../dist/ && zip -q -r $destination ./)

echo "Done creating macro:"
ls $MACRO_DIR | xargs -I _ echo "${MACRO_DIR}/_"

