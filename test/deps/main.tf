variable "repo_name" {
  description = "orgnames/reponame"
  type        = string
}

variable "resource_prefix" {
  default     = "inttest"
  description = "Prefix to resource names"
  type        = string
}

variable "tags" {
  default = {}
  type    = map
}

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
data "aws_region" "current" {}

locals {
  name_prefix                  = "${replace(var.repo_name, "/", "-")}-"
  resource_prefix_with_service = "${split("/", var.repo_name)[1]}-${var.resource_prefix}"
}

data "aws_iam_policy_document" "boundary" {
  statement {
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]

    resources = [
      "arn:${data.aws_partition.current.partition}:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${local.resource_prefix_with_service}*"
    ]
  }

  statement {
    actions = [
      "cognito-idp:AdminInitiateAuth",
    ]

    resources = [
      "arn:${data.aws_partition.current.partition}:cognito-idp:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:userpool/*"
    ]
  }

  statement {
    actions = [
      "dynamodb:DeleteItem",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:Query",
      "dynamodb:Scan",
    ]

    resources = [
      "arn:${data.aws_partition.current.partition}:dynamodb:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:table/${local.resource_prefix_with_service}*"
    ]
  }
}

resource "aws_iam_policy" "boundary" {
  description = "Integration test role boundary policy"
  name_prefix = local.name_prefix
  policy      = data.aws_iam_policy_document.boundary.json
  tags        = var.tags
}

output "boundary_policy_arn" {
  description = "Permissions boundary IAM Managed Policy"
  value       = aws_iam_policy.boundary.arn
}

data "aws_iam_policy_document" "assume_role_policy" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    condition {
      test     = "StringLike"
      variable = "vstoken.actions.githubusercontent.com:sub"

      values = [
        "repo:${var.repo_name}:*",
      ]
    }

    principals {
      identifiers = ["arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/vstoken.actions.githubusercontent.com"]
      type        = "Federated"
    }
  }
}

data "aws_iam_policy_document" "policy" {
  statement {
    actions = [
      "apigateway:GET",
    ]

    resources = [
      "*",
    ]
  }

  statement {
    actions = [
      "apigateway:DELETE",
      "apigateway:POST",
      "apigateway:PUT",
    ]

    resources = [
      "arn:${data.aws_partition.current.partition}:apigateway:${data.aws_region.current.name}::restapis*",
    ]
  }

  statement {
    actions = [
      "cloudformation:ValidateTemplate",
    ]

    resources = [
      "*",
    ]
  }

  statement {
    actions = [
      "cloudformation:CreateStack",
      "cloudformation:CreateChangeSet",
      "cloudformation:DeleteChangeSet",
      "cloudformation:DeleteStack",
      "cloudformation:DescribeChangeSet",
      "cloudformation:DescribeStackEvents",
      "cloudformation:DescribeStackResource",
      "cloudformation:DescribeStacks",
      "cloudformation:ExecuteChangeSet",
      "cloudformation:ListStackResources",
      "cloudformation:TagResource",
      "cloudformation:UntagResource",
      "cloudformation:UpdateStack",
    ]

    resources = [
      "arn:${data.aws_partition.current.partition}:cloudformation:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:stack/${local.resource_prefix_with_service}*"
    ]
  }

  statement {
    actions = [
      "cognito-idp:CreateUserPoolClient",
      "cognito-idp:DeleteUserPoolClient",
    ]

    resources = [
      "arn:${data.aws_partition.current.partition}:cognito-idp:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:userpool/*"
    ]
  }

  statement {
    actions = [
      "cognito-idp:CreateUserPool",
      "cognito-idp:TagResource",
    ]

    resources = [
      "*",
    ]

    condition {
      test     = "StringLike"
      variable = "aws:RequestTag/STAGE"

      values = [
        "${var.resource_prefix}*",
      ]
    }
  }

  statement {
    actions = [
      "cognito-idp:DeleteUserPool",
    ]

    resources = [
      "arn:${data.aws_partition.current.partition}:cognito-idp:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:userpool/*"
    ]

    condition {
      test     = "StringLike"
      variable = "aws:RequestTag/STAGE"

      values = [
        "${var.resource_prefix}*",
      ]
    }
  }

  statement {
    actions = [
      "dynamodb:CreateTable",
      "dynamodb:DeleteItem",
      "dynamodb:DeleteTable",
      "dynamodb:DescribeTable",
      "dynamodb:GetItem",
      "dynamodb:ListTagsOfResource",
      "dynamodb:PutItem",
      "dynamodb:TagResource",
      "dynamodb:UntagResource",
      "dynamodb:UpdateTable",
    ]

    resources = [
      "arn:${data.aws_partition.current.partition}:dynamodb:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:table/${local.resource_prefix_with_service}*"
    ]
  }

  statement {
    actions = [
      "iam:AttachRolePolicy",
      "iam:CreateRole",
      "iam:DetachRolePolicy",
      "iam:PutRolePolicy",
    ]

    resources = [
      "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:role/${local.resource_prefix_with_service}*",
    ]

    condition {
      test     = "StringEquals"
      variable = "iam:PermissionsBoundary"

      values = [
        aws_iam_policy.boundary.arn,
      ]
    }
  }

  statement {
    actions = [
      "iam:DeleteRole",
      "iam:DeleteRolePolicy",
      "iam:GetRole",
      "iam:GetRolePolicy",
      "iam:ListAttachedRolePolicies",
      "iam:ListInstanceProfilesForRole",
      "iam:ListRolePolicies",
      "iam:ListRoleTags",
      "iam:PassRole",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:UpdateRoleDescription",
    ]

    resources = [
      "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:role/${local.resource_prefix_with_service}*",
    ]
  }

  statement {
    actions = [
      "lambda:CreateFunction",
      "lambda:DeleteFunction",
      "lambda:GetFunction",
      "lambda:GetFunctionCodeSigningConfig",
      "lambda:InvokeFunction",
      "lambda:ListTags",
      "lambda:ListVersionsByFunction",
      "lambda:PublishVersion",
      "lambda:TagResource",
      "lambda:UntagResource",
      "lambda:UpdateFunctionCode",
    ]

    resources = [
      "arn:${data.aws_partition.current.partition}:lambda:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:function:${local.resource_prefix_with_service}*",
    ]
  }

  statement {
    actions = [
      "lambda:AddPermission",
      "lambda:RemovePermission",
    ]

    resources = [
      "arn:${data.aws_partition.current.partition}:lambda:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:function:${local.resource_prefix_with_service}*",
    ]

    condition {
      test     = "StringEquals"
      variable = "lambda:Principal"

      values = [
        "apigateway.amazonaws.com",
      ]
    }
  }

  statement {
    actions = [
      "logs:CreateLogGroup",
      "logs:DeleteLogGroup",
    ]

    resources = [
      "arn:${data.aws_partition.current.partition}:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${local.resource_prefix_with_service}*",
    ]
  }

  statement {
    actions = [
      "s3:CreateBucket",
      "s3:DeleteBucket",
      "s3:DeleteBucketPolicy",
      "s3:DeleteObject",
      "s3:DeleteObjectVersion",
      "s3:GetBucketVersioning",
      "s3:GetEncryptionConfiguration",
      "s3:GetLifecycleConfiguration",
      "s3:GetBucketPolicy",
      "s3:GetBucketPolicyStatus",
      "s3:GetObject",
      "s3:HeadObject",
      "s3:ListBucket",
      "s3:ListBucketVersions",
      "s3:PutBucketVersioning",
      "s3:PutBucketPolicy",
      "s3:PutEncryptionConfiguration",
      "s3:PutLifecycleConfiguration",
      "s3:PutObject",
    ]

    resources = [
      "arn:${data.aws_partition.current.partition}:s3:::${local.resource_prefix_with_service}*",
    ]
  }
}

resource "aws_iam_role" "role" {
  assume_role_policy = data.aws_iam_policy_document.assume_role_policy.json
  name_prefix        = local.name_prefix
  tags               = var.tags

  inline_policy {
    name   = "IntegrationTestPermissions"
    policy = data.aws_iam_policy_document.policy.json
  }
}

output "role_arn" {
  description = "IAM Role"
  value       = aws_iam_role.role.arn
}
