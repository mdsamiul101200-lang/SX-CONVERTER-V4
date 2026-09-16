FROM node:22-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    ANDROID_SDK_ROOT=/opt/android-sdk \
    ANDROID_HOME=/opt/android-sdk \
    GRADLE_HOME=/opt/gradle \
    PATH=/opt/gradle/bin:/opt/android-sdk/cmdline-tools/latest/bin:/opt/android-sdk/platform-tools:/opt/android-sdk/build-tools/35.0.0:$PATH

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice \
    poppler-utils \
    unzip \
    zip \
    curl \
    ca-certificates \
    git \
    openjdk-17-jdk \
    && rm -rf /var/lib/apt/lists/*

# Android SDK command-line tools.
RUN mkdir -p ${ANDROID_SDK_ROOT}/cmdline-tools && \
    curl -fsSL -o /tmp/cmdline-tools.zip \
      https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip && \
    unzip -q /tmp/cmdline-tools.zip -d ${ANDROID_SDK_ROOT}/cmdline-tools && \
    mv ${ANDROID_SDK_ROOT}/cmdline-tools/cmdline-tools ${ANDROID_SDK_ROOT}/cmdline-tools/latest && \
    rm /tmp/cmdline-tools.zip && \
    yes | sdkmanager --licenses >/dev/null || true && \
    sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0" && \
    yes | sdkmanager --licenses >/dev/null || true

# Modern Gradle required by Android Gradle Plugin 8.6.x.
RUN curl -fsSL -o /tmp/gradle.zip \
      https://services.gradle.org/distributions/gradle-8.10.2-bin.zip && \
    unzip -q /tmp/gradle.zip -d /opt && \
    ln -s /opt/gradle-8.10.2 ${GRADLE_HOME} && \
    rm /tmp/gradle.zip && \
    gradle --version

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p /app/data/uploads /app/data/outputs /app/data/tmp

EXPOSE 10000
CMD ["node", "server/server.js"]
