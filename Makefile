.PHONY: deploy-cloudflared

up-cloudflared:
	sops -d k8s/platform/cloudflared/secret.enc.yaml | kubectl apply -f -
	kubectl apply -k k8s/platform/cloudflared/

down-cloudflared:
	kubectl delete -k k8s/platform/cloudflared/