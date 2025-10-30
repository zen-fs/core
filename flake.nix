{
    description = "ZenFS";
    inputs = {
        libSource.url = "github:divnix/nixpkgs.lib";
        flake-utils.url = "github:numtide/flake-utils";
        nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.05";
        home-manager.url = "github:nix-community/home-manager/release-25.05";
        home-manager.inputs.nixpkgs.follows = "nixpkgs";
        xome.url = "github:jeff-hykin/xome";
        xome.inputs.nixpkgs.follows = "nixpkgs";
        xome.inputs.home-manager.follows = "home-manager";
    };
    outputs = { self, flake-utils, nixpkgs, xome, ... }:
        flake-utils.lib.eachSystem flake-utils.lib.defaultSystems (system:
            let
                projectName = "zen-fs_core"; # used as directory name (e.g. no slashes)
                pkgs = import nixpkgs {
                    inherit system;
                    overlays = [
                    ];
                    config = {
                        allowUnfree = true;
                        allowInsecure = false;
                        permittedInsecurePackages = [];
                    };
                };
                inputPackages = [
                    pkgs.nodejs
                    pkgs.cacert # needed for installing npm packages
                    pkgs.corepack
                    pkgs.yarn
                    pkgs.esbuild
                    pkgs.graphviz # used for visualizing circular dependencies (e.g. debugging only)
                    pkgs.nodePackages.typescript
                    pkgs.nodePackages.prettier
                ];
            in
                {
                    # development environment for contributions
                    devShells = xome.simpleMakeHomeFor {
                        inherit pkgs;
                        pure = true;
                        homeModule = {
                            # for home-manager examples, see: 
                            # https://deepwiki.com/nix-community/home-manager/5-configuration-examples
                            # all home-manager options: 
                            # https://nix-community.github.io/home-manager/options.xhtml
                            home.homeDirectory = "/tmp/virtual_homes/${projectName}";
                            home.stateVersion = "25.05";
                            home.packages = inputPackages ++ [
                                # vital stuff
                                pkgs.dash # provides "sh" 
                                pkgs.coreutils-full
                                
                                # optional stuff
                                pkgs.gnugrep
                                pkgs.findutils
                                pkgs.wget
                                pkgs.curl
                                pkgs.unixtools.locale
                                pkgs.unixtools.more
                                pkgs.unixtools.ps
                                pkgs.unixtools.getopt
                                pkgs.unixtools.ifconfig
                                pkgs.unixtools.hostname
                                pkgs.unixtools.ping
                                pkgs.unixtools.hexdump
                                pkgs.unixtools.killall
                                pkgs.unixtools.mount
                                pkgs.unixtools.sysctl
                                pkgs.unixtools.top
                                pkgs.unixtools.umount
                                pkgs.git
                                pkgs.htop
                                pkgs.ripgrep
                            ];
                            
                            programs = {
                                home-manager = {
                                    enable = true;
                                };
                                zsh = {
                                    enable = true;
                                    enableCompletion = true;
                                    autosuggestion.enable = true;
                                    syntaxHighlighting.enable = true;
                                    shellAliases.ll = "ls -la";
                                    history.size = 100000;
                                    # this is kinda like .zshrc
                                    initContent = ''
                                        # lots of things need "sh"
                                        ln -s "$(which dash)" "$HOME/.local/bin/sh" 2>/dev/null
                                        
                                        # without this npm (from nix) will not keep a reliable cache (it'll be outside of the xome home)
                                        if ! [ -d "node_modules" ]
                                        then
                                            printf "\n\nI don't see node modules, want me to install them (default=yes)? [y/n]\n";answer=""
                                            while true; do
                                                echo "$question"; read response
                                                case "$response" in
                                                    [Yy]* ) answer='yes'; break;;
                                                    [Nn]* ) answer='no'; break;;
                                                    * ) echo "Please answer yes or no.";;
                                                esac
                                            done
                                            
                                            if [ "$answer" = 'yes' ]; then
                                                yarn install
                                            else
                                                echo "skipping"
                                            fi
                                        fi
                                        export npm_config_cache="$HOME/.cache/npm"
                                        
                                        # this enables some impure stuff like sudo, comment it out to get FULL purity
                                        # export PATH="$PATH:/usr/bin/"
                                        echo
                                        echo "NOTE: if you want to use sudo/git/vim/etc (anything impure) do: sys <that command>"
                                    '';
                                };
                                starship = {
                                    enable = true;
                                    enableZshIntegration = true;
                                    settings = {
                                        character = {
                                            success_symbol = "[∫](bold green)";
                                            error_symbol = "[∫](bold red)";
                                        };
                                    };
                                };
                            };
                        }; 
                    };
                    
                    # as an automated reproducible dependency
                    packages.default = (
                        let
                            # The path to the npm project
                            src = ./.;

                            # Read the package-lock.json as a Nix attrset
                            packageLock = builtins.fromJSON (builtins.readFile (src + "/package-lock.json"));

                            # Create an array of all (meaningful) dependencies
                            deps = builtins.attrValues (removeAttrs packageLock.packages [ "" ])
                                ++ (
                                    if (builtins.hasAttr "dependencies" packageLock) then
                                        builtins.attrValues (removeAttrs packageLock.dependencies [ "" ])
                                    else
                                        []
                                )
                            ;

                            # Turn each dependency into a fetchurl call
                            tarballs = map (p: pkgs.fetchurl { url = p.resolved; hash = p.integrity; }) deps;

                            # Write a file with the list of tarballs
                            tarballsFile = pkgs.writeTextFile {
                                name = "tarballs";
                                text = builtins.concatStringsSep "\n" tarballs;
                            };
                        in
                            pkgs.stdenv.mkDerivation {
                                inherit (packageLock) name version;
                                inherit src;
                                buildInputs = inputPackages; # needed for https
                                
                                buildPhase = ''
                                    # ensure TMPDIR is defined, fallback to /tmp
                                    : ${TMPDIR:=/tmp}
                                    echo "Using TMPDIR=$TMPDIR"

                                    # define writable npm locations
                                    export HOME="$PWD/.home"
                                    export NPM_CONFIG_CACHE="$HOME/.cache/npm"
                                    export npm_config_cache="$NPM_CONFIG_CACHE"
                                    export NPM_CONFIG_TMP="$HOME/.npm-tmp"
                                    export NPM_CONFIG_PREFIX="$out"

                                    # ensure dirs exist and are writable
                                    mkdir -p "$NPM_CONFIG_CACHE" "$NPM_CONFIG_TMP" "$NPM_CONFIG_PREFIX"
                                    
                                    js_path="$out/src"
                                    mkdir -p "$js_path"
                                    cp -r "$src/." "$js_path"
                                    # make locks writable
                                    chmod +w "$js_path/yarn.lock" 2>/dev/null || true
                                    chmod +w "$js_path/package-lock.json" 2>/dev/null || true

                                    cd "$js_path"
                                    while read package
                                    do
                                        echo "caching $package"
                                        npm cache add "$package"
                                    done <${tarballsFile}
                                    
                                    npm ci --no-save --no-audit --no-fund
                                    echo "npm run build"
                                    npm run build
                                '';

                                installPhase = ''
                                    # uncomment below if the project creates binaries to share
                                    # ln -s "$js_path/node_modules/.bin" "$out/bin"
                                    mkdir -p "$out/dist"
                                    cp -r dist/* "$out/dist"
                                '';
                            }
                    );
                }
    );
}