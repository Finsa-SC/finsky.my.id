.PHONY: up-cloudflared down-cloudflared up-nginx down-nginx up down get

up-cloudflared:
	sops -d k8s/platform/cloudflared/secret.enc.yaml | kubectl apply -f -
	kubectl apply -k k8s/platform/cloudflared/

down-cloudflared:
	kubectl delete -k k8s/platform/cloudflared/

up-nginx:
	kubectl apply -k k8s/platform/nginx/

down-nginx:
	kubectl delete -k k8s/platform/nginx/

up:	up-cloudflared up-nginx

down:	down-cloudflared down-nginx

get:
	kubectl get pods
