# Git LFS S3 Storage Service

This project deploys a [Serverless](https://aws.amazon.com/serverless/) [Git LFS](https://git-lfs.github.com/) service, with objects stored on S3 & authentication performed via a Cognito User Pool. Deployment is handled with [Pulumi](https://www.pulumi.com/).

## Purpose

Provides a mechanism to use Git LFS to keep binaries/large files out of your git history that doesn't depend on your git hosting provider. Reasons to use this could include:

- Your git repo hosting doesn't include Git LFS support
- Your existing git repo hosting Git LFS support is cost-prohibitive
- You need to host the files yourself (e.g. retention/[purge](https://help.github.com/en/github/managing-large-files/removing-files-from-git-large-file-storage#git-lfs-objects-in-your-repository) requirements)

## Deploying

### API

- Clone the project
- Execute:
  - `pnpm install`
    - If any errors arise try deleting `pnpm-lock.yaml` and trying again
    - npm, yarn, etc, can also be used
  - `pulumi up` for your environment; e.g. for the "dev" stack: `npulumi up --stack dev`
    - Default region is set to us-west-2 in Pulumi.yaml, update to your desired region.

Upon completion, the 2 relevant stack outputs to note are:

- `apiEndpoint`: This is your Git LFS url
- `userPoolId`: This is your Cognito User Pool id

### Users

After the serverless project is deployed (see `API` above), create a user in the user pool:

```bash
aws cognito-idp admin-create-user --user-pool-id USERPOOLID --username DESIREDUSERNAME --user-attributes Name=email,Value=DESIREDEMAILADDRESS Name=phone_number,Value="+1XXXXXXXXXX" --message-action SUPPRESS --region REGION
```

(substituting `USERPOOLID`, `DESIREDUSERNAME`, `DESIREDEMAILADDRESS`, `REGION`, & the phone number `XXXXXXXXXX`)

Then set a password for that user (ensure it is not saved in your shell history, e.g. for [bash](https://stackoverflow.com/a/29188490/2547802) or [zsh](https://superuser.com/a/352858)):

```bash
 aws cognito-idp admin-set-user-password --user-pool-id USERPOOLID --username DESIREDUSERNAME --password PASSWORDHERE --permanent --region REGION
```

(substituting `USERPOOLID`, `DESIREDUSERNAME`, `PASSWORDHERE`, & `REGION`)

## Configuring a Repo to Use the Git LFS Service

### Prereqs (System-wide -- Once Per Workstation)

Install [Git LFS](https://github.com/git-lfs/git-lfs/wiki/Installation), e.g.:

```bash
brew install git-lfs
git lfs install
```

### Setting up the repo

- Add any file patterns for Git LFS to track, e.g.: `git lfs track "*.deb"`
- Configure the url: `git config -f .lfsconfig remote.origin.lfsurl APIENDPOINTHERE` (subtitute your apiEndpoint url)
- Commit the `.gitattributes` & `.lfsconfig` files

That's it. On push/pull, you'll be prompted for Cognito credentials.

### Handling Files >= 5GB

The backend S3 storage service won't accept files larger than 5GB using Git LFS's normal basic transfer agent. When attempting to upload them, git-lfs-s3 will reject requests that don't claim support for its custom `multipart3upload` [transfer adapter](https://github.com/git-lfs/git-lfs/blob/main/docs/custom-transfers.md).

A python script implementing this is [located here](./git-lfs-multiparts3upload). Download it, place it in your $PATH (e.g. `/usr/local/bin`), ensure it's executable, and configure your repo to use it:

```bash
git config --add lfs.customtransfer.multipart3upload.path git-lfs-multiparts3upload
git config --add lfs.customtransfer.multipart3upload.direction upload
```

(or set the `--global` option to save the options in your user .gitconfig for use with all repositories and allow easy `git clone`ing of repos)

## Further Customization Ideas

- Add an API Gateway custom domain to the API to get a better URL
- Swap out authentication
  - Any backend method (e.g. LDAP) could be adapted into the authorizer in place of the current Cognito AdminInitiateAuth process.
