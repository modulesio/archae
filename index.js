const path = require('path');
const fs = require('fs-extra');
const child_process = require('child_process');

const express = require('express');
const ws = require('ws');
const mkdirp = require('mkdirp');
const rimraf = require('rimraf');

class ArchaeServer {
  constructor(options) {
    options = options || {};

    this._options = options;
  }

  addEngine(engine, opts, cb) {
    if (cb === undefined) {
      cb = opts;
      opts = {};
    }

    if (opts.force) {
      _removeModule(engine, 'engines', err => {
        if (!err) {
          _addModule(engine, 'engines', cb);
        } else {
          cb(err);
        }
      });
    } else {
      _addModule(engine, 'engines', cb);
    }
  }
  
  removeEngine(engine, opts, cb) {
    if (cb === undefined) {
      cb = opts;
      opts = {};
    }

    _removeModule(engine, 'engines', cb);
  }

  addPlugin(plugin, opts, cb) {
    if (cb === undefined) {
      cb = opts;
      opts = {};
    }

    if (opts.force) {
      _removeModule(plugin, 'plugins', err => {
        if (!err) {
          _addModule(plugin, 'plugins', cb);
        } else {
          cb(err);
        }
      });
    } else {
      _addModule(plugin, 'plugins', cb);
    }
  }
  
  removePlugin(plugin, opts, cb) {
    if (cb === undefined) {
      cb = opts;
      opts = {};
    }

    _removeModule(plugin, 'plugins', cb);
  }

  listen({server, app}) {
    server = server || http.createServer();
    app = app || express();

    const {_options: options} = this;

    app.use('/', express.static(path.join(__dirname, 'public')));
    app.use('/archae/plugins.json', (req, res, next) => {
      fs.readdir(path.join(__dirname, 'plugins', 'build'), (err, files) => {
        if (!err) {
          const result = files.map(f => f.replace(/\.js$/, '')).sort();
          res.json(result);
        } else if (err.code === 'ENOENT') {
          res.json([]);
        } else {
          res.status(500);
          res.send(err.stack);
        }
      });
    });
    app.use('/archae/plugins', express.static(path.join(__dirname, 'plugins', 'build')));
    // app.use('/archae/bundle.js', express.static(path.join(__dirname, 'plugins', 'bundle.js')));
    server.on('request', app);

    const wss = new ws.Server({
      server,
    });
    wss.on('connection', c => {
      console.log('connection open');

      c.on('message', s => {
        const m = JSON.parse(s);

        const cb = err => {
          console.warn(err);
        };

        if (typeof m === 'object' && m && typeof m.type === 'string' && typeof m.id === 'string') {
          const cb = (err = null, result = null) => {
            const o = {
              id: m.id,
              error: err,
              result: result,
            };
            const s = JSON.stringify(o);
            c.send(s);
          };

          if (m.type === 'addEngine') {
            const {engine} = m;

            if (_isValidModule(engine)) {
              _addModule(engine, 'engines', cb);
            } else {
              cb('invalid engine spec');
            }
          } else if (m.type === 'removePlugin') {
            const {engine} = m;

            if (_isValidModule(engine)) {
              _removeModule(engine, 'engines', cb);
            } else {
              cb('invalid engine spec');
            }
          } else if (m.type === 'addPlugin') {
            const {plugin} = m;

            if (_isValidModule(plugin)) {
              _addModule(plugin, 'plugins', cb);
            } else {
              cb('invalid plugin spec');
            }
          } else if (m.type === 'removePlugin') {
            const {plugin} = m;

            if (_isValidModule(plugin)) {
              _removeModule(plugin, 'plugins', cb);
            } else {
              cb('invalid plugin spec');
            }
          } else {
            cb('invalid message type');
          }
        } else {
          cb('invalid message');
        }
      });
      c.on('close', () => {
        console.log('connection close');
      });
    });
  }
}

const _addModule = (module, type, cb) => {
  const _downloadModule = (module, type, cb) => {
    if (path.isAbsolute(module)) {
      const modulePackageJsonPath = _getModulePackageJsonPath(module);
      fs.readFile(modulePackageJsonPath, 'utf8', (err, s) => {
        if (!err) {
          const j = JSON.parse(s);
          const moduleName = j.name;
          const modulePath = _getModulePath(moduleName, type);

          fs.exists(modulePath, exists => {
            if (exists) {
              _yarnInstall(moduleName, type, err => {
                if (!err) {
                  cb(null, j);
                } else {
                  cb(err);
                }
              });
            } else {
              const localModulePath = path.join(__dirname, module);
              fs.copy(localModulePath, modulePath, err => {
                if (!err) {
                  _yarnInstall(moduleName, type, err => {
                    if (!err) {
                      cb(null, j);
                    } else {
                      cb(err);
                    }
                  });
                } else {
                  cb(err);
                }
              });
            }
          });
        } else {
          cb(err);

          cleanup();
        }
      });  
    } else {
      _yarnAdd(module, type, err => {
        if (!err) {
          const modulePackageJsonPath = _getModulePackageJsonPath(module, type);
          fs.readFile(modulePackageJsonPath, 'utf8', (err, s) => {
            if (!err) {
              const j = JSON.parse(s);
              cb(null, j);
            } else {
              cb(err);
            }
          });
        } else {
          cb(err);
        }
      });
    }
  };
  const _yarnAdd = (module, type, cb) => {
    _queueYarn(cleanup => {
      const yarnAdd = child_process.spawn(
        'yarn',
        [ 'add', module ],
        {
          cwd: path.join(__dirname, type),
        }
      );
      yarnAdd.stdout.pipe(process.stdout);
      yarnAdd.stderr.pipe(process.stderr);
      yarnAdd.on('exit', code => {
        if (code === 0) {
          cb();
        } else {
          const err = new Error('yarn add error: ' + code);
          cb(err);
        }

        cleanup();
      });
    });
  };
  const _yarnInstall = (module, type, cb) => {
    _queueYarn(cleanup => {
      const modulePath = _getModulePath(module, type);
      const yarnInstall = child_process.spawn(
        'yarn',
        [ 'install' ],
        {
          cwd: modulePath,
        }
      );
      yarnInstall.stdout.pipe(process.stdout);
      yarnInstall.stderr.pipe(process.stderr);
      yarnInstall.on('exit', code => {
        if (code === 0) {
          cb();
        } else {
          const err = new Error('yard install error: ' + code);
          cb(err);
        }

        cleanup();
      });
    });
  };
  const _dumpPlugin = (module, type, cb) => {
    const {name, version = '0.0.1', dependencies = {}, client = 'client.js', server = 'server.js', files} = module;

    if (_isValidModuleSpec(module)) {
      const modulePath = _getModulePath(plugin.name, type);

      mkdirp(modulePath, err => {
        if (!err) {
          const packageJson = {
            name,
            version,
            dependencies,
            client,
            server,
          };
          const packageJsonString = JSON.stringify(packageJson, null, 2);

          fs.writeFile(path.join(modulePath, 'package.json'), packageJsonString, 'utf8', err => {
            if (!err) {
              _yarnInstall(module.name, type, err => {
                if (!err) {
                  if (_isValidFiles(files)) {
                    const fileNames = Object.keys(files);

                    if (fileNames.length > 0) {
                      let pending = fileNames.length;
                      const pend = () => {
                        if (--pending === 0) {
                          cb();
                        }
                      };

                      for (let i = 0; i < fileNames.length; i++) {
                        const fileName = fileNames[i];
                        const fileData = files[fileName];

                        fs.writeFile(path.join(modulePath, fileName), fileData, 'utf8', pend);
                      }
                    } else {
                      cb();
                    }
                  } else {
                    cb(err);
                  }
                } else {
                  cb();
                }
              });
            } else {
              cb(err);
            }
          });
        } else {
          cb(err);
        }
      });
    } else {
      const err = new Error('invalid module declaration');
      cb(err);
    }
  };
  const _buildModule = (module, type, cb) => {
    const moduleClientPath = _getModuleClientPath(module, type);
    const moduleBuildPath = _getModuleBuildPath(module, type);

    const webpack = child_process.spawn(
      path.join(__dirname, 'node_modules', 'webpack', 'bin', 'webpack.js'),
      [ moduleClientPath, moduleBuildPath ],
      {
        cwd: __dirname,
      }
    );
    webpack.stdout.pipe(process.stdout);
    webpack.stderr.pipe(process.stderr);
    webpack.on('exit', code => {
      if (code === 0) {
        cb();
      } else {
        const err = new Error('webpack error: ' + code);
        cb(err);
      }
    });
  };

  mkdirp(path.join(__dirname, type), err => {
    if (!err) {
      const moduleBuildPath = _getModuleBuildPath(module, type);

      fs.exists(moduleBuildPath, exists => {
        if (!exists) {
          if (typeof module === 'string') {
            _downloadModule(module, type, (err, packageJson) => {
              if (!err) {
                _buildModule(packageJson, type, cb);
              } else {
                cb(err);
              }
            });
          } else if (typeof module === 'object') {
            _dumpPlugin(module, type, err => {
              if (!err) {
                _buildModule(module, type, cb);
              } else {
                cb(err);
              }
            });
          } else {
            const err = new Error('invalid module format');
            cb(err);
          }
        } else {
          cb();
        }
      });
    } else {
      console.warn(err);
    }
  });
};

const _removeModule = (module, type, cb) => {
  if (typeof module === 'string') {
    const modulePath = _getModulePath(module, type); // XXX fix package json removal here

    rimraf(modulePath, err => {
      if (!err) {
        const moduleBuildPath = _getModuleBuildPath(module, type);

        rimraf(moduleBuildPath, cb);
      } else {
        cb(err);
      }
    });
  } else if (typeof module ==='object') {
    if (module && typeof module.name === 'string') {
      const moduleBuildPath = _getModuleBuildPath(module.name);

      rimraf(moduleBuildPath, cb);
    } else {
      const err = new Error('invalid module declaration');
      cb(err);
    }
  } else {
    const err = new Error('invalid module format');
    cb(err);
  }
};

const _queueYarn = (() => {
  let running = false;
  const queue = [];

  const _next = handler => {
    if (!running) {
      running = true;

      handler(() => {
        running = false;

        if (queue.length > 0) {
          _next(queue.pop());
        }
      });
    } else {
      queue.push(handler);
    }
  };

  return _next;
})();

const _getModuleName = module => {
  if (typeof module === 'string') {
    return module;
  } else if (_isValidModuleSpec(module)) {
    return module.name;
  } else {
    return null;
  }
};
const _getModulePath = (module, type) => path.join(__dirname, type, 'node_modules', _getModuleName(module));
const _getModulePackageJsonPath = (module, type) => {
  if (path.isAbsolute(module)) {
    return path.join(__dirname, module, 'package.json');
  } else {
    const modulePath = _getModulePath(module, type);
    return path.join(modulePath, 'package.json');
  }
};
const _getModuleClientPath = (module, type) => {
  const modulePath = _getModulePath(module, type);

  if (typeof module === 'string') {
    return modulePath;
  } else if (_isValidModuleSpec(module)) {
    const {client} = module;
    if (client) {
      return path.join(modulePath, client);
    } else {
      const {main = 'index.js'} = module;
      return path.join(modulePath, main);
    }
  } else {
    return null;
  }
};
const _getModuleBuildPath = (module, type) => path.join(__dirname, type, 'build', _getModuleName(module) + '.js');

const _isValidModule = module => typeof module === 'string' || _isValidModuleSpec(module);
const _isValidModuleSpec = module => {
  const {name, version = '', dependencies = {}, client = '', server = ''} = module;

  return typeof name === 'string' &&
    typeof version === 'string' &&
    typeof client === 'string' &&
    typeof server === 'string' &&
    _isValidDependencies(dependencies);
};
const _isValidDependencies = dependencies => {
  if (dependencies && typeof dependencies === 'object' && !Array.isArray(dependencies)) {
    for (const k in dependencies) {
      const v = dependencies[k];
      if (typeof v !== 'string') {
        return false;
      }
    }
    return true;
  } else {
    return false;
  }
};

const _isValidFiles = files => {
  if (files && typeof files === 'object' && !Array.isArray(files)) {
    for (const k in files) {
      const v = files[k];
      if (typeof v !== 'string') {
        return false;
      }
    }
    return true;
  } else {
    return false;
  }
};

const archae = (opts) => new ArchaeServer(opts);

module.exports = archae;
