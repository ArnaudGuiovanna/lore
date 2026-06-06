package llm

import (
	"errors"
	"net"
	"net/http"
	"syscall"
	"time"
)

// ErrBlockedAddress is returned when an LLM request would connect to a
// non-public network address (a likely SSRF target such as cloud metadata or
// an internal service).
var ErrBlockedAddress = errors.New("llm request blocked: destination address is not permitted")

// GuardedHTTPClient returns an http.Client hardened against SSRF for use with
// tenant-configurable provider base URLs. It refuses to follow redirects and
// blocks connections to private, loopback, link-local, unspecified, multicast,
// and carrier-grade NAT IP ranges. The check runs at dial time against the
// resolved address, which also defeats DNS rebinding.
func GuardedHTTPClient(timeout time.Duration) *http.Client {
	dialer := &net.Dialer{Timeout: 10 * time.Second, Control: blockNonPublic}
	return &http.Client{
		Timeout: timeout,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
		Transport: &http.Transport{
			Proxy:               http.ProxyFromEnvironment,
			DialContext:         dialer.DialContext,
			TLSHandshakeTimeout: 10 * time.Second,
		},
	}
}

func blockNonPublic(_, address string, _ syscall.RawConn) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return err
	}
	ip := net.ParseIP(host)
	if ip == nil || isBlockedIP(ip) {
		return ErrBlockedAddress
	}
	return nil
}

func isBlockedIP(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() ||
		ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() {
		return true
	}
	// 100.64.0.0/10 (carrier-grade NAT) is not globally routable.
	if v4 := ip.To4(); v4 != nil && v4[0] == 100 && v4[1] >= 64 && v4[1] <= 127 {
		return true
	}
	return false
}
