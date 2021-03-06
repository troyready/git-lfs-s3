# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.1] - 2021-03-17
### Changed
- Update to serverless-webpack v5.4 & enable serialized function compilation

## [1.2.0] - 2021-02-10
### Changed
- Update to aws sdk v3
- Package functions individually

## [1.1.0] - 2021-01-21
### Added
- Git LFS locking support

### Changed
- Dropped legacy aws sdk code

## [1.0.1] - 2019-12-09
### Changed
- Dropped webpack-node-externals in favor of bundling in aws-sdk directly
  - This significantly increases the package size (+2MB), but demonstrates better technical correctness by using the exact sdk version specified in package.json

### Fixed
- Dependency security updates

## [1.0.0] - 2019-11-06
### Added
- Initial release

[Unreleased]: https://github.com/troyready/git-lfs-s3/compare/v1.2.1...HEAD
[1.2.1]: https://github.com/troyready/git-lfs-s3/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/troyready/git-lfs-s3/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/troyready/git-lfs-s3/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/troyready/git-lfs-s3/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/troyready/git-lfs-s3/releases/tag/v1.0.0
