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
                pkgs = import nixpkgs {
                    inherit system;
                    overlays = [
                    ];
                    config = {
                        allowUnfree = true;
                        allowInsecure = false;
                        permittedInsecurePackages = [
                        ];
                    };
                };
                inputPackages = [
                    pkgs.nodejs
                    pkgs.esbuild
                    pkgs.nodePackages.typescript
                    pkgs.nodePackages.prettier
                ];
            in
                {
                    # this is how the package is built (as a dependency)
                    packages.default = pkgs.stdenv.mkDerivation {
                        name = "my-ts-app";
                        src = ./.;

                        buildInputs = inputPackages;

                        buildPhase = ''
                            export HOME=$(mktemp -d) # Needed by npm to avoid global install warnings
                            npm install
                            tsc
                        '';

                        installPhase = ''
                            mkdir -p $out
                            cp -r dist/* $out/
                        '';
                    };
                    
                    # development environment for contributions
                    devShells = xome.simpleMakeHomeFor {
                        inherit pkgs;
                        pure = true;
                        homeModule = {
                            # for home-manager examples, see: 
                            # https://deepwiki.com/nix-community/home-manager/5-configuration-examples
                            # all home-manager options: 
                            # https://nix-community.github.io/home-manager/options.xhtml
                            home.homeDirectory = "/tmp/virtual_homes/zenfs";
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
                                        
                                        # this enables some impure stuff like sudo, comment it out to get FULL purity
                                        # export PATH="$PATH:/usr/bin/"
                                        echo
                                        echo "NOTE: if you want to use sudo/git/vim/etc (anything impure) do: sys <that command>"
                                    '';
                                };
                                starship = {
                                    enable = true;
                                    enableZshIntegration = true;
                                };
                            };
                        }; 
                    };
                }
    );
}