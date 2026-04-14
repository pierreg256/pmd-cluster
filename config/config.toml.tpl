port = 4369
bind = "BIND_ADDR"

discovery = ["azure-tag"]

heartbeat_interval_secs = 2
sync_interval_secs = 5

phi_threshold = 8.0
phi_window_size = 1000
phi_min_std_deviation_ms = 500

metrics_port = 9090

[metadata]
role = "worker"
cluster = "${pmd_cluster_tag_value}"
