FROM node:10

# Create app directory
WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

# Openvpn stuff
RUN apt-get update && apt-get install -y openvpn
VOLUME ["/vpn"]

# Bundle app source
COPY index.js index.js
COPY static static

EXPOSE 80
CMD [ "node", "index.js" ]
