.PHONY: up-cloudflared down-cloudflared up-nginx down-nginx up-downloader down-downloader up-kuma down-kuma up-adguard down-adguard up-filebrowser down-filebrowser up-typing-duel down-typing-duel up-game down-game up down get

### === Cloudflared ===
up-cloudflared:
	sops -d k8s/platform/cloudflared/secret.enc.yaml | kubectl apply -f -
	kubectl apply -k k8s/platform/cloudflared/

down-cloudflared:
	kubectl delete -k k8s/platform/cloudflared/

### === Nginx ===
up-nginx:
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

### === Adguard Home ===
up-adguard:
	kubectl apply -k k8s/platform/adguard/

down-adguard:
	kubectl delete -k k8s/platform/adguard/

### === Filebrowser ===
up-filebrowser:
	sops -d k8s/platform/filebrowser/secret.enc.yaml | kubectl apply -f -
	kubectl apply -k k8s/platform/filebrowser/

down-filebrowser:
	kubectl delete -k k8s/platform/filebrowser/

### === Typing Game ===
up-typing-duel:
	kubectl apply -k k8s/apps/games/typing-duel/

down-typing-duel:
	kubectl delete -k k8s/apps/games/typing-duel/
	
### === Game ===
up-game:	up-typing-duel
	
down-game:	down-typing-duel

### === finsky.my.id ===
up:	up-cloudflared up-nginx up-downloader up-kuma up-adguard up-filebrowser up-game

down:	down-cloudflared down-nginx down-downloader down-kuma down-adguard down-filebrowser down-game

get:
	kubectl get pods
