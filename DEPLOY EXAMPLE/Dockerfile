FROM ubuntu
RUN apt-get update && \
    apt-get install -y build-essential pip net-tools iputils-ping iproute2 curl

RUN curl -fsSL https://deb.nodesource.com/setup_16.x | bash -
RUN apt-get install -y nodejs
RUN npm install -g watchify


COPY package.json .
RUN npm install && npm install -g browserify
COPY app.js .
COPY server server
COPY public public

EXPOSE 3000
ENV PORT 3000

CMD ["npm", "start"]