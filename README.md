# Git LFS S3 Storage Service

[![Build Status](https://travis-ci.org/troyready/git-lfs-s3.svg?branch=master)](https://travis-ci.org/troyready/git-lfs-s3)


This project deploys a [Serverless](https://serverless.com/cli/) [Git LFS](https://git-lfs.github.com/) service, with objects stored on S3 & authentication performed via a Cognito User Pool.

## Purpose

Provides a mechanism to use Git LFS to keep binaries/large files out of your git history that doesn't depend on your git hosting provider. Reasons to use this could include:

* Your git repo hosting doesn't include Git LFS support
* Your existing git repo hosting Git LFS support is cost-prohibitive
* You need to host the files yourself (e.g. retention/[purge](https://help.github.com/en/github/managing-large-files/removing-files-from-git-large-file-storage#git-lfs-objects-in-your-repository) requirements)

## Deploying

### API

* Clone the project
* Execute:
    * `npm install`
        * If any errors arise try deleting `package-lock.json` and trying again
    * sls deploy for your stage & region; e.g. for the "common" stage in oregon: `npx sls deploy -s common -r us-west-2 --verbose`

Upon completion, the 2 relevant stack outputs to note are:
* `ServiceEndpoint`: This is your Git LFS url
* `UserPoolId`: This is your Cognito User Pool id

### Users

After the serverless project is deployed (see `API` above), create a user in the user pool:

```
aws cognito-idp admin-create-user --user-pool-id USERPOOLID --username DESIREDUSERNAME --user-attributes=Name=email,Value=DESIREDEMAILADDRESS,Name=phone_number,Value="+1XXXXXXXXXX" --message-action SUPPRESS --region REGION
```
(substituting `USERPOOLID`, `DESIREDUSERNAME`, `DESIREDEMAILADDRESS`, `REGION`, & the phone number `XXXXXXXXXX`)

Then set a password for that user (ensure [it is not saved in your shell history](https://stackoverflow.com/a/29188490/2547802)):
```
 aws cognito-idp admin-set-user-password --user-pool-id USERPOOLID --username DESIREDUSERNAME --password PASSWORDHERE --permanent --region REGION
```
(substituting `USERPOOLID`, `DESIREDUSERNAME`, `PASSWORDHERE`, & `REGION`)

## Configuring a Repo to Use the Git LFS Service

### Prereqs (System-wide -- Once Per Workstation)

Install [Git LFS](https://github.com/git-lfs/git-lfs/wiki/Installation), e.g.:
```
brew install git-lfs
git lfs install
```

### Setting up the repo

* Add any file patterns for Git LFS to track, e.g.: `git lfs track "*.deb"`
* Configure the url: `git config -f .lfsconfig remote.origin.lfsurl SERVICEENDPOINTHERE` (subtitute your ServiceEndpoint url)
* Commit the `.gitattributes` & `.lfsconfig` files

That's it. On push/pull, you'll be prompted for Cognito credentials.

## Further Customization Ideas

* Add an API Gateway custom domain to the API to get a better URL
    * One option for this would be to use [Runway](https://github.com/onicagroup/runway) to tie together this project & a [Terraform](https://www.terraform.io/) project to handle the ACM Certificate & custom domain
* Swap out authentication
    * Any backend method (e.g. LDAP) could be adapted into the authorizer in place of the current Cognito AdminInitiateAuth process.
