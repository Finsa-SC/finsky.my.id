.PHONY: up-cloudflared down-cloudflared up-nginx down-nginx up-downloader down-downloader up-kuma down-kuma up-adguard down-adguard up-filebrowser down-filebrowser up down get

up-cloudflared:
	sops -d k8s/platform/cloudflared/secret.enc.yaml | kubectl apply -f -
	kubectl apply -k k8s/platform/cloudflared/

down-cloudflared:
	kubectl delete -k k8s/platform/cloudflared/

up-nginx:
	kubectl apply -k k8s/platform/nginx/

down-nginx:
	kubectl delete -k k8s/platform/nginx/

restart-nginx: down-nginx up-nginx

up-downloader:
	kubectl apply -k k8s/apps/downloader/

down-downloader:
	kubectl apply -k k8s/apps/downloader/

up-kuma:
	kubectl apply -k k8s/platform/uptime-kuma/

down-kuma:
	kubectl delete -k k8s/platform/uptime-kuma/

up-adguard:
	kubectl apply -k k8s/platform/adguard/

down-adguard:
	kubectl delete -k k8s/platform/adguard/

up-filebrowser:
	kubectl apply -k k8s/platform/filebrowser/

down-filebrowser:
	kubectl delete -k k8s/platform/filebrowser/

up:	up-cloudflared up-nginx up-downloader up-kuma up-adguard up-filebrowser

down:	down-cloudflared down-nginx down-downloader down-kuma down-adguard down-filebrowser

get:
	kubectl get pods
