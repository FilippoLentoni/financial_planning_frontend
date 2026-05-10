/**
 * Stream Animation - Handles streaming visual effects
 */

(function() {
    'use strict';

    /**
     * StreamAnimation constructor
     */
    function StreamAnimation() {
        this.isStreaming = false;
        this.textFlowQueue = [];
        this.isFlowAnimating = false;
        this.pendingTextBuffer = '';
    }

    /**
     * Start streaming animation (robot, particles, data streams)
     */
    StreamAnimation.prototype.start = function() {
        // Activate robot speaker
        var robotOverlay = document.getElementById('robot-speaker-overlay');
        if (robotOverlay) {
            robotOverlay.classList.add('active', 'speaking');
        }
        
        // Activate particles
        var particles = document.getElementById('stream-particles');
        if (particles) {
            particles.classList.add('active');
            this.createFlowingParticles();
        }
        
        // Activate data stream background
        var dataBg = document.getElementById('data-stream-bg');
        if (dataBg) {
            dataBg.classList.add('active');
            this.createDataStreamColumns();
        }
        
        this.isStreaming = true;
    };

    /**
     * Stop streaming animation
     */
    StreamAnimation.prototype.stop = function() {
        // Deactivate robot speaker
        var robotOverlay = document.getElementById('robot-speaker-overlay');
        if (robotOverlay) {
            robotOverlay.classList.remove('active', 'speaking');
        }
        
        // Deactivate particles
        var particles = document.getElementById('stream-particles');
        if (particles) {
            particles.classList.remove('active');
            var existingParticles = particles.querySelectorAll('.stream-particle');
            existingParticles.forEach(function(p) { p.remove(); });
        }
        
        // Deactivate data stream background
        var dataBg = document.getElementById('data-stream-bg');
        if (dataBg) {
            dataBg.classList.remove('active');
            dataBg.innerHTML = '';
        }
        
        this.isStreaming = false;
    };

    /**
     * Create flowing particles around edges
     */
    StreamAnimation.prototype.createFlowingParticles = function() {
        var container = document.getElementById('stream-particles');
        if (!container) return;
        
        var particleChars = ['⟨', '⟩', '◦', '•', '○', '●', '∘', '⊛', '⊕', '⊗', '△', '▽', '◇', '◆'];
        var directions = ['flow-top', 'flow-right', 'flow-bottom', 'flow-left'];
        
        for (var d = 0; d < directions.length; d++) {
            for (var i = 0; i < 3; i++) {
                var particle = document.createElement('span');
                particle.className = 'stream-particle ' + directions[d];
                particle.textContent = particleChars[Math.floor(Math.random() * particleChars.length)];
                particle.style.animationDelay = (i * 1.5 + d * 0.5) + 's';
                container.appendChild(particle);
            }
        }
    };

    /**
     * Create data stream columns (matrix-style background)
     */
    StreamAnimation.prototype.createDataStreamColumns = function() {
        var container = document.getElementById('data-stream-bg');
        if (!container) return;
        
        var chars = '01アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン';
        
        for (var i = 0; i < 10; i++) {
            var column = document.createElement('div');
            column.className = 'data-stream-column';
            
            var text = '';
            for (var j = 0; j < 30; j++) {
                text += chars[Math.floor(Math.random() * chars.length)];
            }
            column.textContent = text;
            container.appendChild(column);
        }
    };

    /**
     * Initialize text flow queue
     */
    StreamAnimation.prototype.initTextFlowQueue = function() {
        this.textFlowQueue = [];
        this.isFlowAnimating = false;
        this.pendingTextBuffer = '';
    };

    /**
     * Add text to the flow queue
     */
    StreamAnimation.prototype.queueTextFlow = function(text, msgId) {
        this.pendingTextBuffer += text;
        
        var shouldFlush = /[\s\n.,!?;:]$/.test(this.pendingTextBuffer) || this.pendingTextBuffer.length > 15;
        
        if (shouldFlush && this.pendingTextBuffer.trim()) {
            var chunk = this.pendingTextBuffer;
            this.pendingTextBuffer = '';
            
            this.textFlowQueue.push({
                text: chunk,
                msgId: msgId
            });
            
            this.processTextFlowQueue();
        }
    };

    /**
     * Flush any remaining text in the buffer
     */
    StreamAnimation.prototype.flushTextFlowQueue = function(msgId) {
        if (this.pendingTextBuffer) {
            this.textFlowQueue.push({
                text: this.pendingTextBuffer,
                msgId: msgId
            });
            this.pendingTextBuffer = '';
            this.processTextFlowQueue();
        }
    };

    /**
     * Process the text flow queue
     */
    StreamAnimation.prototype.processTextFlowQueue = function() {
        var self = this;
        
        if (this.isFlowAnimating || this.textFlowQueue.length === 0) {
            return;
        }
        
        this.isFlowAnimating = true;
        var item = this.textFlowQueue.shift();
        
        this.createFlowingTextElement(item.text, function() {
            self.isFlowAnimating = false;
            self.processTextFlowQueue();
        });
    };

    /**
     * Create a text element that flows out of the robot's mouth and around the edge
     */
    StreamAnimation.prototype.createFlowingTextElement = function(text, callback) {
        var container = document.getElementById('stream-particles');
        if (!container) {
            callback();
            return;
        }
        
        var textEl = document.createElement('div');
        textEl.className = 'flowing-text-element';
        textEl.textContent = text;
        container.appendChild(textEl);
        
        var containerRect = container.getBoundingClientRect();
        var width = containerRect.width;
        var height = containerRect.height;
        
        var robotMouthX = width / 2;
        var robotMouthY = 95;
        
        var duration = 2000;
        var startTime = null;
        
        function getPositionOnPath(progress) {
            if (progress < 0.15) {
                var p = progress / 0.15;
                return {
                    x: robotMouthX,
                    y: robotMouthY + p * 30
                };
            }
            
            if (progress < 0.30) {
                var p = (progress - 0.15) / 0.15;
                var angle = Math.PI / 2 - (p * Math.PI / 2);
                return {
                    x: robotMouthX + Math.cos(angle) * 80 + (1 - Math.cos(angle)) * (width / 2 - 12 - robotMouthX),
                    y: robotMouthY + 30 + Math.sin(angle) * 50
                };
            }
            
            if (progress < 0.50) {
                var p = (progress - 0.30) / 0.20;
                return {
                    x: width - 12,
                    y: robotMouthY + 80 + p * (height - robotMouthY - 80 - 150)
                };
            }
            
            if (progress < 0.70) {
                var p = (progress - 0.50) / 0.20;
                return {
                    x: width - 12 - p * (width - 24),
                    y: height - 150
                };
            }
            
            if (progress < 0.85) {
                var p = (progress - 0.70) / 0.15;
                return {
                    x: 12,
                    y: height - 150 - p * 100
                };
            }
            
            var p = (progress - 0.85) / 0.15;
            return {
                x: 12 + p * 60,
                y: height - 250 - p * 50
            };
        }
        
        function animate(timestamp) {
            if (!startTime) startTime = timestamp;
            var elapsed = timestamp - startTime;
            var progress = Math.min(elapsed / duration, 1);
            
            if (progress >= 1) {
                textEl.remove();
                callback();
                return;
            }
            
            var pos = getPositionOnPath(progress);
            
            var opacity = 1;
            if (progress < 0.08) {
                opacity = progress / 0.08;
            } else if (progress > 0.85) {
                opacity = (1 - progress) / 0.15;
            }
            
            var scale = 1;
            if (progress < 0.15) {
                scale = 0.8 + progress / 0.15 * 0.2;
            } else if (progress > 0.7) {
                scale = 1 - (progress - 0.7) / 0.3 * 0.5;
            }
            
            textEl.style.left = pos.x + 'px';
            textEl.style.top = pos.y + 'px';
            textEl.style.opacity = opacity;
            textEl.style.transform = 'translate(-50%, -50%) scale(' + scale + ')';
            
            requestAnimationFrame(animate);
        }
        
        requestAnimationFrame(animate);
    };

    /**
     * Animate communication particle between main chat and worker panel
     */
    StreamAnimation.prototype.animateCommunicationParticle = function(direction) {
        var particle = document.createElement('div');
        particle.className = 'communication-particle ' + direction;
        
        if (direction === 'to-worker') {
            particle.style.left = (window.innerWidth - 450) + 'px';
            particle.style.top = '200px';
        } else {
            particle.style.left = (window.innerWidth - 30) + 'px';
            particle.style.top = '300px';
        }
        
        document.body.appendChild(particle);
        
        var startX = parseFloat(particle.style.left);
        var startY = parseFloat(particle.style.top);
        var endX = direction === 'to-worker' ? (window.innerWidth - 30) : (window.innerWidth - 450);
        var endY = direction === 'to-worker' ? 300 : 200;
        
        var duration = 600;
        var startTime = null;
        
        function animate(timestamp) {
            if (!startTime) startTime = timestamp;
            var progress = Math.min((timestamp - startTime) / duration, 1);
            
            var eased = 1 - Math.pow(1 - progress, 3);
            
            particle.style.left = (startX + (endX - startX) * eased) + 'px';
            particle.style.top = (startY + (endY - startY) * eased) + 'px';
            particle.style.opacity = progress < 0.8 ? 1 : (1 - progress) / 0.2;
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                particle.remove();
            }
        }
        
        requestAnimationFrame(animate);
    };

    // Export
    window.ChatbotUtils = window.ChatbotUtils || {};
    window.ChatbotUtils.StreamAnimation = StreamAnimation;

})();