Deploying riskcardashboard with nginx

This README shows two simple ways to deploy the static dashboard with nginx:

1) Using Docker Compose (recommended for local/dev and simple server deployments)
2) Installing nginx directly on an Ubuntu/Debian server (systemd)

Prerequisites
- Docker and docker-compose (for method 1)
- Or a Linux server with sudo access and nginx installed (for method 2)

Method 1 — Docker Compose (quick local preview or production)

Files created:
- docker-compose.yml — runs an nginx container and mounts the repo files into /usr/share/nginx/html
- nginx/default.conf — nginx site configuration used inside the container

Steps
1. From the project root (where this README sits) run:

```powershell
# ensure Docker is running, then
docker compose up -d
```

2. Open http://localhost:8080 in your browser. nginx will serve `index.html` and static assets.
3. To stop and remove containers:

```powershell
docker compose down
```

Notes and extensions
- You can bind to port 80 by changing the `ports` mapping to `80:80` (Linux hosts only without extra privileges on Windows).
- For production, consider placing a reverse proxy (Traefik, cloud load balancer) in front for TLS and routing.

Method 2 — Install nginx on a Linux server

This is useful when you want nginx as a system service instead of Docker.

1. Copy the repository files to the server (use scp, rsync, or git clone)
2. Install nginx (Debian/Ubuntu):

```bash
sudo apt update; sudo apt install -y nginx
```

3. Copy `nginx/default.conf` into `/etc/nginx/sites-available/riskcardashboard` and create a symlink to `sites-enabled`:

```bash
sudo cp nginx/default.conf /etc/nginx/sites-available/riskcardashboard
sudo ln -s /etc/nginx/sites-available/riskcardashboard /etc/nginx/sites-enabled/riskcardashboard
```

4. Ensure the site root files are placed in `/var/www/riskcardashboard` or update the `root` in the config.

```bash
sudo mkdir -p /var/www/riskcardashboard
sudo cp -r * /var/www/riskcardashboard/  # careful: copy only the site files
sudo chown -R www-data:www-data /var/www/riskcardashboard
```

5. Test and reload nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

6. Visit the server's IP or domain in a browser.

TLS / HTTPS
- For production, use Certbot or your own certificate provider and attach TLS to nginx. Example with Certbot (Debian/Ubuntu):

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d example.com -d www.example.com
```

Troubleshooting
- Check nginx logs: `/var/log/nginx/error.log` and `/var/log/nginx/access.log`.
- When using Docker, check `docker compose logs web`.

If you'd like, I can:
- Add a small systemd service or Ansible playbook for remote deployment.
- Create a Dockerfile that bakes the site into a custom nginx image (instead of bind-mounts).
- Set up automatic TLS with Let's Encrypt using a small compose + proxy stack.

