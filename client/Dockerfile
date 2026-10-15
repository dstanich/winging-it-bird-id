FROM node:24

####
# The client Dockerfile is used for the scheduled publish script, which will pull in the client files and regularly builds it.
# Details of the process can be found in the scripts/scheduled-publish directory.
#
# Volumes:
# - /app/data: for reading the SQLite database file created by server code
# - /app/public/downloads: for reading downloaded thumbnails
####

WORKDIR /app

# Copy dependency files first for layer caching
COPY package.json package-lock.json ./
COPY scripts/scheduled-publish/package.json scripts/scheduled-publish/package-lock.json ./scripts/scheduled-publish/

# Install dependencies for both packages
RUN npm ci
RUN cd scripts/scheduled-publish && npm ci

# Copy client source files
COPY . .

# Create mount point directories
RUN mkdir -p data public/downloads

# Declare volumes
VOLUME ["/app/data", "/app/public/downloads"]

# Entry point: scheduled-publish script
WORKDIR /app/scripts/scheduled-publish
CMD ["npm", "start"]
