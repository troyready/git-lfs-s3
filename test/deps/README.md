## AWS Setup

Set the following GitHub repository secrets for integration tests.

### IAM Role

Ensure the repo is listed as one of the valid ClientIds on the OIDC Provider (see below). Then create the IAM Role via CloudFormation:

```bash
aws cloudformation create-stack --stack-name prod-git-lfs-s3-repo-inttest-role --region us-west-2 --template-body file://iam_role.yml --parameters ParameterKey=EnvironmentName,ParameterValue=prod ParameterKey=RepoName,ParameterValue=troyready/git-lfs-s3 ParameterKey=ServiceName,ParameterValue=git-lfs-s3 --capabilities CAPABILITY_NAMED_IAM
aws cloudformation wait stack-create-complete --region us-west-2 --stack-name prod-git-lfs-s3-repo-inttest-role
aws cloudformation describe-stacks --region us-west-2 --stack-name prod-git-lfs-s3-repo-inttest-role --query 'Stacks[0].Outputs'
```

Then create the repository secrets:

- `AWS_PERMISSIONS_BOUNDARY_ARN` - set to the `BoundaryPolicyArn` stack output
- `AWS_ROLE_ARN` - set to the `RoleArn` stack output

#### Updates

Perform subsequent stack updates via:

```bash
aws cloudformation update-stack --stack-name prod-git-lfs-s3-repo-inttest-role --region us-west-2 --template-body file://iam_role.yml --parameters ParameterKey=EnvironmentName,ParameterValue=prod ParameterKey=RepoName,ParameterValue=troyready/git-lfs-s3 ParameterKey=ServiceName,ParameterValue=git-lfs-s3 --capabilities CAPABILITY_NAMED_IAM
aws cloudformation wait stack-update-complete --region us-west-2 --stack-name prod-git-lfs-s3-repo-inttest-role
```

### OIDC Provider

An AWS IAM Identity provider must be created and configured for GitHub, e.g. in CFN:

```
  GithubOidc:
    Type: AWS::IAM::OIDCProvider
    Properties:
      ClientIdList:
        <other repos here>
        - https://github.com/troyready/git-lfs-s3
      ThumbprintList:
        - a031c46782e6e6c662c2c87c76da9aa62ccabd8e
      Url: https://vstoken.actions.githubusercontent.com
```

Current thumbprint can be retrieved via:

```bash
node -e 'const https = require("https"); https.get("https://vstoken.actions.githubusercontent.com/.well-known/openid-configuration", (res) => {console.log(res.socket.getPeerCertificate(true).issuerCertificate.fingerprint.replace(/:/g, "").toLowerCase())});'
```

or in Terraform:

```
data "tls_certificate" "github_actions_oidc_provider" {
  url = "https://vstoken.actions.githubusercontent.com/.well-known/openid-configuration"
}

resource "aws_iam_openid_connect_provider" "github_actions" {
  url = "https://vstoken.actions.githubusercontent.com"

  client_id_list = [
    <other repos>
    "https://github.com/troyready/git-lfs-s3",
  ]

  thumbprint_list = [
    data.tls_certificate.github_actions_oidc_provider.certificates[0].sha1_fingerprint,
  ]
}
```
