.PHONY: up-cloudflared down-cloudflared up-nginx down-nginx up-downloader down-downloader up-kuma down-kuma up down get

up-cloudflared:
	sops -d k8s/platform/cloudflared/secret.enc.yaml | kubectl apply -f -
	kubectl apply -k k8s/platform/cloudflared/

down-cloudflared:
	kubectl delete -k k8s/platform/cloudflared/

up-nginx:
	kubectl apply -k k8s/platform/nginx/

down-nginx:
	kubectl delete -k k8s/platform/nginx/

up-downloader:
	kubectl apply -k k8s/apps/downloader/

down-downloader:
	kubectl apply -k k8s/apps/downloader/

up-kuma:
	kubectl apply -k k8s/platform/uptime-kuma/

down-kuma:
	kubectl delete -k k8s/platform/uptime-kuma/

up:	up-cloudflared up-nginx up-downloader up-kuma

down:	down-cloudflared down-nginx down-downloader down-kuma

get:
	kubectl get pods
