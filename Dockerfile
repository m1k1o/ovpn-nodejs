FROM node:10

# Create app directory
WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

# Install openvpn & squid
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y openvpn squid=${SQUID_VERSION}* \
 && rm -rf /var/lib/apt/lists/*

COPY squid.conf /etc/squid/squid.conf
EXPOSE 3128/tcp

VOLUME ["/vpn"]

# Bundle app source
COPY index.js index.js
COPY static static

ENTRYPOINT [ "node", "index.js" ]

EXPOSE 80
CMD [ "80"]