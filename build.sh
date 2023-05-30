podman manifest rm lospringliu/cloudreporter:latest
podman build --platform linux/arm64 --platform linux/amd64 --manifest lospringliu/cloudreporter:latest .
podman manifest push -f v2s2 lospringliu/cloudreporter:latest docker.io/lospringliu/cloudreporter:latest
#sleep 3
#podman push lospringliu/cloudreporter:latest quay.io/cidtest/cloudreporter:latest
