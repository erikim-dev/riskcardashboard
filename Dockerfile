# Multi-stage simple build not needed (static site). Use official nginx image and copy site files.
# Pin to a specific patched nginx alpine tag to avoid vulnerabilities; update this tag periodically.
FROM nginx:1.26-alpine

# Update system packages to pick up security fixes for vulnerabilities in base image
RUN apk update && apk upgrade --no-cache

# Remove default nginx html
RUN rm -rf /usr/share/nginx/html/*

# Copy project files into nginx document root
# We copy index.html, styles.css, script.js, data and assets directory
COPY index.html /usr/share/nginx/html/index.html
COPY styles.css /usr/share/nginx/html/styles.css
COPY script.js /usr/share/nginx/html/script.js
COPY data /usr/share/nginx/html/data
COPY assets /usr/share/nginx/html/assets

# Copy a custom nginx config if present in the build context
COPY nginx/default.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
