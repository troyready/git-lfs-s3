## AWS Setup

Set the following GitHub repository secrets for integration tests.

### IAM User

Create the IAM Role via CloudFormation:

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
