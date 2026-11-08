.PHONY: up-cloudflared down-cloudflared up-nginx down-nginx up-downloader down-downloader up-kuma down-kuma up-adguard down-adguard up-filebrowser down-filebrowser up-typing-duel down-typing-duel up-game down-game up-namespace down-namespace up-grafana down-grafana up down get

### === Cloudflared ===
up-cloudflared:
	sops -d k8s/platform/cloudflared/secret.enc.yaml | kubectl apply -n finsky-platform -f -
	kubectl apply -k k8s/platform/cloudflared/

down-cloudflared:
	kubectl delete -k k8s/platform/cloudflared/

### === Nginx ===
up-nginx:
	kubectl rollout status deployment/downloader-deploy -n finsky-apps --timeout=120s
	kubectl rollout status deployment/filebrowser-deploy -n finsky-platform --timeout=120s
	kubectl rollout status deployment/adguard-deploy -n finsky-platform --timeout=120s
	kubectl rollout status deployment/uptime-kuma-deploy -n finsky-platform --timeout=120s
	kubectl rollout status deployment/typing-duel-deploy -n finsky-apps --timeout=120s
	kubectl apply -k k8s/platform/nginx/

down-nginx:
	kubectl delete -k k8s/platform/nginx/

restart-nginx: down-nginx up-nginx

### === Downloader ===
up-downloader:
	kubectl apply -k k8s/apps/downloader/

down-downloader:
	kubectl delete -k k8s/apps/downloader/

### === Uptime Kuma ===
up-kuma:
	kubectl apply -k k8s/platform/uptime-kuma/

down-kuma:
	kubectl delete -k k8s/platform/uptime-kuma/

### === Grafana ===
up-grafana:
	sops -d k8s/platform/grafana/secret.enc.yaml | kubectl apply -n finsky-platform -f -
	kubectl apply -k k8s/platform/grafana/

down-grafana:
	kubectl delete -k k8s/platform/grafana/

### === Adguard Home ===
up-adguard:
	kubectl apply -k k8s/platform/adguard/

down-adguard:
	kubectl delete -k k8s/platform/adguard/

### === Filebrowser ===
up-filebrowser:
	sops -d k8s/platform/filebrowser/secret.enc.yaml | kubectl apply -n finsky-platform -f -
	kubectl apply -k k8s/platform/filebrowser/

down-filebrowser:
	kubectl delete -k k8s/platform/filebrowser/

up-namespace:
	kubectl apply -k k8s/namespaces/

down-namespace:
	kubectl delete -k k8s/namespaces/

### === Typing Game ===
up-typing-duel:
	kubectl apply -k k8s/apps/games/typing-duel/

down-typing-duel:
	kubectl delete -k k8s/apps/games/typing-duel/
	
### === Game ===
up-game:	up-typing-duel
	
down-game:	down-typing-duel

### === finsky.my.id ===
up:	up-cloudflared up-downloader up-kuma up-adguard up-filebrowser up-game up-grafana up-nginx

down:	down-cloudflared down-downloader down-kuma down-adguard down-filebrowser down-game down-grafana down-nginx

get:
	@kubectl get pods -A | grep "finsky" || echo "no pod found."
