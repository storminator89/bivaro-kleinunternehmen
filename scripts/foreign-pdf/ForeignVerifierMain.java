package org.bivaro.pdfa;

import org.verapdf.apps.GreenfieldCliWrapper;
import org.verapdf.io.SeekableInputStream;

/** Foreign-only stream storage configuration; official validation is unchanged. */
public final class ForeignVerifierMain {
    private ForeignVerifierMain() { }

    public static void main(String[] args) throws Exception {
        SeekableInputStream.setMaxStreamSize(2097152);
        SeekableInputStream.setMaxBufferSize(2097153);
        GreenfieldCliWrapper.main(args);
    }
}
