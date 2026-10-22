/** Reviewed application adapter identity, not a configurable validator. */
export const ADAPTER_MAIN='org.bivaro.pdfa.ForeignVerifierMain';
export const ADAPTER_CLASS='org/bivaro/pdfa/ForeignVerifierMain.class';
export const ADAPTER_SOURCE='ForeignVerifierMain.java';
export const ADAPTER_SOURCE_SHA256='6ead7b6d5f29551359661e8b077dd43461af4c9a3d4608a9812e96c2465484b9';
export const OFFICIAL_CLI_SHA256='19f6edd5c92841a38d9b3b018a555b7ba173b13e4e0d29edecc232e5ba6c1d70';
export const NEW_STREAM_MAX_BYTES=2*1024*1024;
export const BUFFER_THRESHOLD_BYTES=NEW_STREAM_MAX_BYTES+1;
export const COMPILER_FLAGS=Object.freeze(['--release','21','-proc:none','-g:none','-encoding','UTF-8']);
