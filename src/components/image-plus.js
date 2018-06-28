import GIFWorker from "../workers/gifparsing.worker.js";

class GIFTexture extends THREE.Texture {
  constructor(frames, delays, disposals) {
    super(document.createElement("canvas"));
    this._ctx = this.image.getContext("2d");

    this.generateMipmaps = false;
    this.isVideoTexture = true;
    this.minFilter = THREE.NearestFilter;

    this.frames = frames;
    this.delays = delays;
    this.disposals = disposals;

    this.frame = 0;
    this.frameStartTime = Date.now();
  }

  update() {
    if (!this.frames || !this.delays || !this.disposals) return;
    const now = Date.now();
    if (now - this.frameStartTime > this.delays[this.frame]) {
      if (this.disposals[this.frame] === 2) {
        this._ctx.clearRect(0, 0, this.image.width, this.image.width);
      }
      this.frame = (this.frame + 1) % this.frames.length;
      this.frameStartTime = now;
      this._ctx.drawImage(this.frames[this.frame], 0, 0, this.image.width, this.image.height);
      this.needsUpdate = true;
    }
  }
}

AFRAME.registerComponent("image-plus", {
  dependencies: ["geometry", "material"],

  schema: {
    src: { type: "string" },

    initialOffset: { default: { x: 0, y: 0, z: -1.5 } },
    reorientOnGrab: { default: false }
  },

  _fit(w, h) {
    const ratio = (h || 1.0) / (w || 1.0);
    const geo = this.el.geometry;
    let width, height;
    if (geo && geo.width) {
      if (geo.height && ratio > 1) {
        width = geo.width / ratio;
      } else {
        height = geo.height * ratio;
      }
    } else if (geo && geo.height) {
      width = geo.width / ratio;
    } else {
      width = Math.min(1.0, 1.0 / ratio);
      height = Math.min(1.0, ratio);
    }
    this.el.setAttribute("geometry", { width, height });
    this.el.setAttribute("shape", {
      halfExtents: {
        x: width / 2,
        y: height / 2,
        z: 0.05
      }
    });
  },

  _onMaterialLoaded(e) {
    const src = e.detail.src;
    const w = src.videoWidth || src.width;
    const h = src.videoHeight || src.height;
    if (w || h) {
      this._fit(w, h);
    }
  },

  _onGrab: (function() {
    const q = new THREE.Quaternion();
    return function() {
      if (this.data.reorientOnGrab) {
        this.billboardTarget.getWorldQuaternion(q);
        this.el.body.quaternion.copy(q);
      }
    };
  })(),

  init() {
    this._onMaterialLoaded = this._onMaterialLoaded.bind(this);
    this._onGrab = this._onGrab.bind(this);

    this.el.addEventListener("materialtextureloaded", this._onMaterialLoaded);
    this.el.addEventListener("materialvideoloadeddata", this._onMaterialLoaded);
    this.el.addEventListener("grab-start", this._onGrab);

    const worldPos = new THREE.Vector3().copy(this.data.initialOffset);
    this.billboardTarget = document.querySelector("#player-camera").object3D;
    this.billboardTarget.localToWorld(worldPos);
    this.el.object3D.position.copy(worldPos);
    this.billboardTarget.getWorldQuaternion(this.el.object3D.quaternion);
  },

  async loadGIF(url) {
    const worker = new GIFWorker();
    worker.onmessage = e => {
      const [success, frames, delays, disposals] = e.data;
      if (!success) {
        console.error("error loading gif", e.data[1]);
        return;
      }

      let loadCnt = 0;
      for (let i = 0; i < frames.length; i++) {
        const img = new Image();
        img.onload = e => {
          loadCnt++;
          frames[i] = e.target;
          if (loadCnt === frames.length) {
            const material = this.el.components.material.material;
            material.map = new GIFTexture(frames, delays, disposals);
            material.needsUpdate = true;
            this._fit(frames[0].width, frames[0].height);
          }
        };
        img.src = frames[i];
      }
    };
    const rawImageData = await fetch(url, { mode: "cors" }).then(r => r.arrayBuffer());
    worker.postMessage(rawImageData, [rawImageData]);
  },

  async update() {
    const mediaJson = await fetch("https://smoke-dev.reticulum.io/api/v1/media", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        media: {
          url: this.data.src
        }
      })
    }).then(r => r.json());
    const imageUrl = mediaJson.images.raw;
    const contentType = await fetch(imageUrl, { method: "HEAD" }).then(r => r.headers.get("content-type"));
    if (contentType === "image/gif") {
      return this.loadGIF(imageUrl);
    } else {
      this.el.setAttribute("material", "src", `url(${imageUrl})`);
      return Promise.resolve();
    }
  }
});
