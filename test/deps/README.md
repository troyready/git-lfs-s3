## AWS Setup

Set the following GitHub repository secrets for integration tests.

### IAM Role

Ensure the repo is listed as one of the valid ClientIds on the OIDC Provider (see below), then create the role and secrets with this directory's Terraform module:

```
resource "github_repository" "repo" {
  name = <repo_name>
}

module "role" {
  source = "github.com/<repo_full_name>//test/deps"

  repo_name = github_repository.repo.full_name
}

resource "github_actions_secret" "AWS_PERMISSIONS_BOUNDARY_ARN" {
  repository      = github_repository.repo.name
  plaintext_value = module.role.boundary_policy_arn
  secret_name     = "AWS_PERMISSIONS_BOUNDARY_ARN"
}

resource "github_actions_secret" "AWS_ROLE_ARN" {
  repository      = github_repository.repo.name
  plaintext_value = module.role.role_arn
  secret_name     = "AWS_ROLE_ARN"
}
```

### OIDC Provider

An AWS IAM Identity provider must be created and configured for GitHub, e.g. in CFN:

```
  GithubOidc:
    Type: AWS::IAM::OIDCProvider
    Properties:
      ClientIdList:
        <other repos here>
        - https://github.com/<repo_full_name>
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
    "https://github.com/<repo_full_name>",
  ]

  thumbprint_list = [
    data.tls_certificate.github_actions_oidc_provider.certificates[0].sha1_fingerprint,
  ]
}
```
