# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
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

[Unreleased]: https://github.com/troyready/git-lfs-s3/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/troyready/git-lfs-s3/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/troyready/git-lfs-s3/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/troyready/git-lfs-s3/releases/tag/v1.0.0
