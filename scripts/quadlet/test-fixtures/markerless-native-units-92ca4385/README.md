# Markerless native unit fixture

This directory preserves the path-dependent native service syntax installed by
commit `92ca4385961311103c419c22d6ddb33a3c62d9d9`, before target-path markers were
introduced. The image placeholder in the migration service is replaced with the
synthetic tag `legacy-profile`; no runtime environment values or credentials are
stored here.

`check-profile-tests.sh` archives these services and verifies that
`restore-config.sh` relocates both the `%h/.config/containers/systemd` unit paths
and the `$HOME/.config/containers/systemd` shell fallback to a non-default target.
