FROM node:14

# Create app directory
WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

# Install openvpn & squid
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update; \
    apt-get install -y --no-install-recommends openvpn squid; \
    #
    # clean up
    apt-get clean -y; \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/*

COPY squid.conf /etc/squid/squid.conf
EXPOSE 3128/tcp

VOLUME ["/vpn"]

# Bundle app source
COPY index.js index.js
COPY static static

ENTRYPOINT [ "node", "index.js" ]

EXPOSE 80
CMD [ "80"]
