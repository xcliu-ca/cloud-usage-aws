podman rmi lospringliu/cloudreporter:latest 
podman build --platform linux/arm64 -t lospringliu/cloudreporter:latest .
podman push lospringliu/cloudreporter:latest docker.io/lospringliu/cloudreporter:latest
#sleep 3
#podman push lospringliu/cloudreporter:latest quay.io/cidtest/cloudreporter:latest
