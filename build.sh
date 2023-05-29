podman rmi lospringliu/cloudreporter:latest 
podman build --platform linux/arm64 -t lospringliu/cloudreporter:latest .
#sleep 3
#podman push lospringliu/roks-enabler:latest quay.io/cicdtest/roks-enabler:latest
#podman push lospringliu/roks-enabler:latest docker.io/lospringliu/roks-sync:latest  
