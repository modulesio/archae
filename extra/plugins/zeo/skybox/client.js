const Alea = require('alea');
const SkyShader = require('./lib/three-extra/SkyShader');

class Skybox {
  constructor(archae) {
    this._archae = archae;
  }

  mount() {
    const {_archae: archae} = this;

    let live = true;
    this._cleanup = () => {
      live = false;
    };

    return Promise.all([
      archae.requestEngines([
        '/core/engines/zeo',
      ]),
      archae.requestPlugins([
        '/core/plugins/geometry-utils',
      ]),
    ]).then(([
      [zeo],
      [geometryUtils]
    ]) => {
      if (live) {
        const {THREE, scene} = zeo;
        SkyShader(THREE);

        const MAP_SUN_MATERIAL = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          fog: false,
        });
        // MAP_SUN_MATERIAL.depthTest = false;
        const MAP_STARS_MATERIAL = new THREE.PointsMaterial({
          color: 0xFFFFFF,
          size: 500,
          fog: false,
          // opacity: 1,
          transparent: true,
        });
        // MAP_STARS_MATERIAL.depthTest = false;
        const MAP_MOON_MATERIAL = new THREE.MeshPhongMaterial({
          color: 0x808080,
          // emissive: 0x333333,
          // specular: 0x000000,
          shininess: 0,
          // side: THREE.BackSide,
          shading: THREE.FlatShading,
          // vertexColors: THREE.VertexColors,
          fog: false,
        });
        // MAP_MOON_MATERIAL.depthTest = false;

        const zeroVector = new THREE.Vector3(0, 0, 0);

        const sky = (() => {
          const sky = new THREE.Sky();

          const {uniforms} = sky;
          uniforms.turbidity.value = 10;
          uniforms.rayleigh.value = 2;
          uniforms.luminance.value = 1;
          uniforms.mieCoefficient.value = 0.005;
          uniforms.mieDirectionalG.value = 0.8;

          sky.inclination = 0;
          sky.azimuth = 0;

          sky.mesh.material.depthWrite = false;

          return sky;
        })();
        scene.add(sky.mesh);

        const sunSphere = (() => {
          const geometry = geometryUtils.unindexBufferGeometry(new THREE.SphereBufferGeometry(20000, 5, 4));
          const material = MAP_SUN_MATERIAL;
          const sunSphere = new THREE.Mesh(geometry, material);
          // sunSphere.position.y = -700000;
          sunSphere.distance = 300000;
          // sunSphere.frustumCulled = false;
          sunSphere.renderOrder = 1;
          return sunSphere;
        })();
        scene.add(sunSphere);

        const sunLight = (() => {
          const light = new THREE.DirectionalLight(0xffffff, 2);
          light.position.copy(sunSphere.position);
          return light;
        })();
        scene.add(sunLight);

        const starsMesh = (() => {
          const numStars = 1000;

          const geometry = (() => {
            const result = new THREE.BufferGeometry();
            const vertices = new Float32Array(numStars * 3);
            for (let i = 0; i < numStars; i++) {
              const radius = 100000 + (Math.random() * (200000 - 100000));
              const theta = Math.random() * (Math.PI * 2);
              const phi = Math.random() * (Math.PI * 2);

              vertices[(i * 3) + 0] = radius * Math.cos(theta) * Math.sin(phi);
              vertices[(i * 3) + 1] = radius * Math.sin(theta) * Math.sin(phi);
              vertices[(i * 3) + 2] = radius * Math.cos(phi);
            }
            result.addAttribute('position', new THREE.BufferAttribute(vertices, 3));
            return result;
          })();
          const material = MAP_STARS_MATERIAL;
          const mesh = new THREE.Points(geometry, material);
          // mesh.frustumCulled = false;
          // mesh.renderOrder = 1;
          return mesh;
        })();
        scene.add(starsMesh);

        const moonSphere = (() => {
          const geometry = geometryUtils.unindexBufferGeometry(new THREE.SphereBufferGeometry(20000, 5, 4));
          const material = MAP_MOON_MATERIAL;
          const moonSphere = new THREE.Mesh(geometry, material);
          // moonSphere.position.z = -700000;
          // moonSphere.frustumCulled = false;
          moonSphere.renderOrder = 1;
          return moonSphere;
        })();
        scene.add(moonSphere);

        const _update = ({worldTime}) => {
          const speed = 1;
          // const speed = 50;
          worldTime += 60000;
          sky.azimuth = (0.05 + ((worldTime / 1000) * speed) / (60 * 10)) % 1;
          const theta = Math.PI * (sky.inclination - 0.5);
          const phi = 2 * Math.PI * (sky.azimuth - 0.5);

          const x = sunSphere.distance * Math.cos(phi);
          const y = sunSphere.distance * Math.sin(phi) * Math.sin(theta);
          const z = sunSphere.distance * Math.sin(phi) * Math.cos(theta);

          sky.uniforms.sunPosition.value.x = x;
          sky.uniforms.sunPosition.value.y = y;
          sky.uniforms.sunPosition.value.z = z;

          sunSphere.position.set(x, y, z);
          // sunSphere.rotation.x = Math.PI / 2;
          // sunSphere.rotation.y = Math.PI / 2;
          sunSphere.rotation.z = -phi;
          sunSphere.rotation.order = 'ZXY';

          sunLight.position.set(x, y, z);
          sunLight.lookAt(zeroVector);

          starsMesh.rotation.z = -sky.azimuth * (Math.PI * 2);
          const nightCutoff = 0.1;
          const nightWidth = 0.5 + (nightCutoff * 2);
          const nightRatio = (() => {
            if (sky.azimuth < nightCutoff) {
              return (sky.azimuth + 1 - (0.5 - nightCutoff)) / nightWidth;
            } else if (sky.azimuth < (0.5 - nightCutoff)) {
              return 0;
            } else /* if (sky.azimuth >= (0.5 - nightCutoff)) */ {
              return (sky.azimuth - (0.5 - nightCutoff)) / nightWidth;
            }
          })();
          const nightAmplitude = Math.sin(nightRatio * Math.PI);
          const starsOpacity = 0.75;
          const starsAmplitude = nightAmplitude * starsOpacity;
          starsMesh.material.opacity = starsAmplitude;

          moonSphere.position.x = -x;
          moonSphere.position.y = -y;
          moonSphere.position.z = -z;
          // moonSphere.rotation.x = Math.PI / 2;
          // moonSphere.rotation.y = Math.PI / 2;
          moonSphere.rotation.z = -phi;
          moonSphere.rotation.order = 'ZXY';
        };

        return {
          update: _update,
        };
      }
    });
  }

  unmount() {
    this._cleanup();
  }
}

module.exports = Skybox;